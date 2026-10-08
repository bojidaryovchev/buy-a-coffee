import type { Database } from "@catalog/db";
import { type Logger, silentLogger } from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import type { Fetcher } from "../fetch/fetcher.ts";
import { type ProductCharacteristic, parseProductPage } from "../parsers/productPage.ts";
import type { ExistingProduct } from "./diff.ts";
import type { NormalizedProduct } from "./normalize.ts";
import {
  type EnrichmentTarget,
  countProductCodes,
  ensureSourceSite,
  loadProductsWithoutCode,
  loadSharedProductCodes,
  markEnrichmentDue,
  markEnrichmentFailed,
  recordScrapeError,
  storeEnrichment,
} from "./repository.ts";

/**
 * Product-page enrichment.
 *
 * The catalog listing is one request for every product, but it does not carry
 * everything: the product code and the labelled characteristics are printed
 * only on each product's own page. This module reads those pages — sparingly —
 * and is the only writer of what it finds (`ENRICHMENT_COLUMNS` in
 * `repository.ts`).
 *
 * Three rules shape it:
 *
 *  1. Every read goes through the `Fetcher`, so robots.txt, spacing, retries
 *     and the body limit apply exactly as they do to the listing.
 *  2. Reads are budgeted. A `ProductPageReader` is created with the number of
 *     requests a run may make and refuses the next one when they are spent. It
 *     also gives up early on a run of failures: a source that is unwell is not
 *     helped by another hundred requests.
 *  3. A failed read is an ordinary outcome. It is returned as data, recorded
 *     and counted; nothing here throws for it, and nothing here can change a
 *     product's status or the trust placed in a sync.
 */

/** What a product page contributes. Absent stays null; nothing is inferred. */
export interface ProductPageFacts {
  /** The product code as printed, e.g. `00072`. */
  readonly sku: string | null;
  readonly characteristics: ProductCharacteristic[];
  readonly arabicaPercent: number | null;
  readonly origin: string | null;
  readonly roast: string | null;
}

export interface ProductPageFailure {
  readonly url: string;
  readonly stage: "enrich_fetch" | "enrich_parse";
  /** The fetch outcome, or `not_a_product_page`. */
  readonly outcome: string;
  readonly statusCode: number | null;
  readonly attempts: number;
  readonly message: string;
}

export type ProductPageRead =
  | { readonly ok: true; readonly url: string; readonly facts: ProductPageFacts }
  | { readonly ok: false; readonly failure: ProductPageFailure };

/** Labelled rows the detail block of every product page prints. */
const DETAIL_ATTRIBUTES = ["availability", "code", "weight", "intensity"] as const;

/**
 * Read the facts out of a product page, or return null when the HTML is not
 * one. A page with a heading and none of the detail rows is something else —
 * an error page that answered 200, a category — and storing "no code, no
 * characteristics" from it would erase what a real read had found.
 */
export function interpretProductPage(html: string): ProductPageFacts | null {
  const parsed = parseProductPage(html);
  const looksLikeProduct =
    parsed.name !== null &&
    (parsed.sku !== null || DETAIL_ATTRIBUTES.some((key) => parsed.attributes[key] !== undefined));
  if (!looksLikeProduct) return null;

  return {
    sku: parsed.sku,
    characteristics: parsed.characteristics.map(({ label, value }) => ({ label, value })),
    // The column is a whole number of percent. A fractional figure cannot be
    // stored "exactly as stated", and rounding it would be stating something
    // else; it stays readable in `characteristics`.
    arabicaPercent:
      parsed.arabicaPercent !== null && Number.isInteger(parsed.arabicaPercent)
        ? parsed.arabicaPercent
        : null,
    origin: parsed.origin,
    roast: parsed.roast,
  };
}

/** Consecutive failed reads after which a reader stops asking. */
export const MAX_CONSECUTIVE_READ_FAILURES = 5;

/** Hours before a product page that failed is tried again by a sync. */
export const ENRICH_RETRY_AFTER_HOURS = 24;

export interface ProductPageReaderOptions {
  readonly fetcher: Fetcher;
  readonly config: Pick<ScraperConfig, "canonicalHost" | "hostAliases">;
  /** Requests this reader may make. Zero disables it. */
  readonly budget: number;
  readonly logger?: Logger;
}

/**
 * Reads product pages within a request budget, remembering each answer.
 *
 * One reader lives for one run. The pre-diff lookup and the enrichment step
 * share it, so a page looked up to pair a rename is not requested again to be
 * stored, and the budget is one number for the whole run.
 */
export class ProductPageReader {
  private readonly fetcher: Fetcher;
  private readonly hosts: ReadonlySet<string>;
  private readonly logger: Logger;
  private readonly budget: number;
  private readonly cache = new Map<string, ProductPageRead>();
  private requested = 0;
  private consecutiveFailures = 0;

  constructor(options: ProductPageReaderOptions) {
    this.fetcher = options.fetcher;
    this.hosts = new Set([options.config.canonicalHost, ...options.config.hostAliases]);
    this.logger = options.logger ?? silentLogger;
    this.budget = Math.max(0, Math.floor(options.budget));
  }

  /** Requests made so far. Cached answers are not requests. */
  get requests(): number {
    return this.requested;
  }

  /** True once a run of failures has made the reader stop asking. */
  get halted(): boolean {
    return this.consecutiveFailures >= MAX_CONSECUTIVE_READ_FAILURES;
  }

  /** Requests the reader will still make. */
  get remaining(): number {
    return this.halted ? 0 : Math.max(0, this.budget - this.requested);
  }

  /** Every page that could not be read, once each. */
  get failures(): ProductPageFailure[] {
    return [...this.cache.values()].flatMap((read) => (read.ok ? [] : [read.failure]));
  }

  /** True when `read(url)` would answer from memory, without a request. */
  hasRead(url: string): boolean {
    return this.cache.has(url);
  }

  /**
   * Read one product page. Returns null — and requests nothing — when the
   * budget is spent or the reader has halted.
   */
  async read(url: string): Promise<ProductPageRead | null> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    if (this.remaining <= 0) return null;

    const result = await this.request(url);
    this.cache.set(url, result);
    if (result.ok) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
      this.logger.warn("enrich.page_failed", { ...result.failure });
      if (this.halted) {
        this.logger.warn("enrich.halted", {
          consecutiveFailures: this.consecutiveFailures,
          note: "Too many product pages failed in a row; no more are requested in this run.",
        });
      }
    }
    return result;
  }

  private async request(url: string): Promise<ProductPageRead> {
    const fail = (
      failure: Omit<ProductPageFailure, "url" | "attempts"> & { attempts?: number },
    ): ProductPageRead => ({ ok: false, failure: { url, attempts: 0, ...failure } });

    // A listing that pointed somewhere else would turn this into a crawler of
    // other people's sites. Not a request, so not charged to the budget.
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return fail({
        stage: "enrich_fetch",
        outcome: "invalid_url",
        statusCode: null,
        message: "The product URL is not a URL.",
      });
    }
    if (!this.hosts.has(host)) {
      return fail({
        stage: "enrich_fetch",
        outcome: "off_site",
        statusCode: null,
        message: `Refusing to read a product page on ${host}.`,
      });
    }

    this.requested += 1;
    try {
      const response = await this.fetcher.get(url);
      if (response.outcome !== "ok") {
        return fail({
          stage: "enrich_fetch",
          outcome: response.outcome,
          statusCode: response.statusCode,
          attempts: response.attempts,
          message:
            response.error?.message ??
            `outcome=${response.outcome} status=${response.statusCode ?? "-"}`,
        });
      }
      const facts = interpretProductPage(response.body);
      if (!facts) {
        return fail({
          stage: "enrich_parse",
          outcome: "not_a_product_page",
          statusCode: response.statusCode,
          attempts: response.attempts,
          message: "The page answered, but it is not recognisable as a product page.",
        });
      }
      return { ok: true, url, facts };
    } catch (error) {
      // The fetcher reports failures as outcomes and the parser is total; this
      // is for the failure nobody anticipated, which must still not escape.
      return fail({
        stage: "enrich_parse",
        outcome: "unexpected_error",
        statusCode: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// --- Pre-diff product-code lookup ----------------------------------------------

export type SkuLookupSkip =
  /** The lookup cap is zero. */
  | "disabled"
  /** Every discovered product matches a stored key. */
  | "no_candidates"
  /** No vanished row holds a product code, so a code could pair nothing. */
  | "nothing_to_pair_with"
  /** More unmatched products than the cap: this is a mass rename, not an edit. */
  | "over_cap";

export interface SkuLookupPlan {
  /** Discovered products to look up; empty whenever `skipped` is set. */
  readonly candidates: NormalizedProduct[];
  /** Discovered products that match no stored key, whether or not looked up. */
  readonly candidateCount: number;
  readonly skipped: SkuLookupSkip | null;
}

/**
 * Decide which discovered products need their product code looked up before
 * the diff. Pure: it reads nothing and requests nothing.
 *
 * A product that matches no stored key is either new or a rename. The diff can
 * recognise a rename by name; it cannot when the name changed too, unless it
 * knows the product code — which only the product page states. So the code is
 * fetched for those few products, and only when it could matter: when some
 * stored row that this run did not see holds a code to compare against.
 *
 * Above `maxCandidates` the lookup is skipped altogether rather than done for
 * the first few. Many unmatched products at once is the source renaming its
 * URLs wholesale, where names do not change and the name-based passes pair
 * everything (as they did for the 86-product rename) — and a partial lookup
 * would pair some products on stronger evidence than their neighbours for no
 * reason but list order.
 */
export function planSkuLookup(
  discovered: readonly NormalizedProduct[],
  existing: readonly ExistingProduct[],
  options: { readonly maxCandidates: number },
): SkuLookupPlan {
  const storedKeys = new Set(existing.map((product) => product.sourceKey));
  const unmatched = discovered.filter((product) => !storedKeys.has(product.sourceKey));
  const skip = (skipped: SkuLookupSkip): SkuLookupPlan => ({
    candidates: [],
    candidateCount: unmatched.length,
    skipped,
  });

  if (options.maxCandidates <= 0) return skip("disabled");

  // A listing that states its own code needs no lookup. A page shared by two
  // pack sizes prints one code, which would wrongly give both the same.
  const candidates = unmatched.filter(
    (product) => !product.sku?.trim() && !product.hasUrlCollision,
  );
  if (candidates.length === 0) return skip("no_candidates");

  const seenKeys = new Set(discovered.map((product) => product.sourceKey));
  const pairable = existing.some(
    (product) => !seenKeys.has(product.sourceKey) && Boolean(product.sku?.trim()),
  );
  if (!pairable) return skip("nothing_to_pair_with");

  if (candidates.length > options.maxCandidates) return skip("over_cap");
  return { candidates, candidateCount: unmatched.length, skipped: null };
}

export interface SkuLookupResult {
  /** Source key -> product code, for `diffCatalog`'s `discoveredSkus`. */
  readonly skus: Map<string, string>;
  readonly candidateCount: number;
  /** Pages asked for (answered from the reader, by request or from its cache). */
  readonly looked: number;
  readonly found: number;
  readonly skipped: SkuLookupSkip | "budget_exhausted" | null;
}

/**
 * Look up the product code of each would-be-created product.
 *
 * The result is plain data for the diff. A page that fails, or prints no code,
 * simply contributes nothing: that product is then paired by name or created,
 * exactly as it would have been without the lookup.
 */
export async function lookupDiscoveredSkus(input: {
  readonly discovered: readonly NormalizedProduct[];
  readonly existing: readonly ExistingProduct[];
  readonly reader: ProductPageReader;
  readonly maxCandidates: number;
  readonly logger?: Logger;
}): Promise<SkuLookupResult> {
  const logger = input.logger ?? silentLogger;
  const plan = planSkuLookup(input.discovered, input.existing, {
    // The lookup spends the run's budget; it may not exceed what is left.
    maxCandidates: Math.min(input.maxCandidates, input.reader.remaining),
  });
  const skus = new Map<string, string>();

  if (plan.skipped) {
    if (plan.skipped === "over_cap") {
      logger.info("enrich.lookup_skipped", {
        reason: plan.skipped,
        candidates: plan.candidateCount,
        maxCandidates: input.maxCandidates,
      });
    }
    return {
      skus,
      candidateCount: plan.candidateCount,
      looked: 0,
      found: 0,
      skipped: plan.skipped,
    };
  }

  let looked = 0;
  let exhausted = false;
  for (const product of plan.candidates) {
    const read = await input.reader.read(product.sourceUrl);
    if (read === null) {
      exhausted = true;
      break;
    }
    looked += 1;
    if (read.ok && read.facts.sku !== null) skus.set(product.sourceKey, read.facts.sku);
  }

  logger.info("enrich.lookup_complete", {
    candidates: plan.candidateCount,
    looked,
    found: skus.size,
  });
  return {
    skus,
    candidateCount: plan.candidateCount,
    looked,
    found: skus.size,
    skipped: exhausted ? "budget_exhausted" : null,
  };
}

// --- Storing what the pages say -------------------------------------------------

export interface EnrichmentSummary {
  /** Products whose page was read and stored. */
  readonly enriched: number;
  /** Products whose page could not be read. */
  readonly failed: number;
  /** Products left for a later run because the budget was spent. */
  readonly deferred: number;
  /** Stored codes the page now contradicts. Worth a person's attention. */
  readonly skuChanges: Array<{ sourceKey: string; from: string; to: string }>;
}

/**
 * Read each target's page and store what it says.
 *
 * Targets are taken in order, so callers put what matters most first. One that
 * cannot be read within the budget is marked due and reported as deferred, to
 * be picked up from the backlog by a later run.
 */
export async function enrichProducts(input: {
  readonly db: Database;
  readonly reader: ProductPageReader;
  readonly targets: readonly EnrichmentTarget[];
  readonly logger?: Logger;
}): Promise<EnrichmentSummary> {
  const { db, reader } = input;
  const logger = input.logger ?? silentLogger;
  let enriched = 0;
  let failed = 0;
  const deferred: string[] = [];
  const skuChanges: EnrichmentSummary["skuChanges"] = [];

  for (const target of input.targets) {
    const read = await reader.read(target.sourceUrl);
    if (read === null) {
      deferred.push(target.productId);
      continue;
    }
    if (!read.ok) {
      failed += 1;
      await markEnrichmentFailed(db, target.productId);
      continue;
    }

    const { facts } = read;
    // One page, two pack sizes: its single code identifies neither of them.
    const sku = target.hasUrlCollision ? null : facts.sku;
    if (sku !== null && target.sku !== null && target.sku !== sku) {
      // Either the source renumbered the product, or this row was paired with
      // the wrong listing. The page is believed; a person is told.
      skuChanges.push({ sourceKey: target.sourceKey, from: target.sku, to: sku });
      logger.warn("enrich.sku_changed", { sourceKey: target.sourceKey, from: target.sku, to: sku });
    }
    await storeEnrichment(db, target.productId, {
      sku,
      arabicaPercent: facts.arabicaPercent,
      origin: facts.origin,
      roast: facts.roast,
      characteristics: facts.characteristics,
    });
    enriched += 1;
  }

  await markEnrichmentDue(db, deferred);
  return { enriched, failed, deferred: deferred.length, skuChanges };
}

/** Write one `scrape_errors` row per page a reader could not read. */
export async function recordReadFailures(
  db: Database,
  failures: readonly ProductPageFailure[],
  context: { sourceSiteId: string; syncRunId?: string | null; kind: string },
): Promise<void> {
  for (const failure of failures) {
    await recordScrapeError(db, {
      sourceSiteId: context.sourceSiteId,
      syncRunId: context.syncRunId ?? null,
      url: failure.url,
      stage: failure.stage,
      errorClass: failure.outcome,
      errorMessage: failure.message,
      statusCode: failure.statusCode,
      retryCount: Math.max(0, failure.attempts - 1),
      metadata: { kind: context.kind },
    });
  }
}

// --- catalog:enrich ---------------------------------------------------------------

export interface CatalogEnrichOptions {
  readonly config: ScraperConfig;
  readonly db: Database;
  readonly fetcher: Fetcher;
  readonly logger?: Logger;
  /** Write. Without it the command reports what it would read and stops. */
  readonly apply?: boolean;
  /** Read at most this many product pages. */
  readonly limit?: number;
}

export interface CatalogEnrichResult {
  readonly applied: boolean;
  /** Active products, and how many have a product code, before this run. */
  readonly before: { active: number; withCode: number; withoutCode: number };
  /** The same counts afterwards; equal to `before` on a plan. */
  readonly after: { active: number; withCode: number; withoutCode: number };
  /** Products this run would read (plan) or set out to read (apply). */
  readonly selected: number;
  /** Requests to the source: zero on a plan. */
  readonly requests: number;
  readonly enriched: number;
  readonly failed: number;
  /** Selected but not read, because the reader halted on repeated failures. */
  readonly deferred: number;
  readonly halted: boolean;
  readonly failures: ProductPageFailure[];
  readonly skuChanges: EnrichmentSummary["skuChanges"];
  /** Codes held by more than one active product after the run. */
  readonly sharedCodes: Array<{ sku: string; slugs: string[] }>;
  /** First few products selected, so a plan shows what it means. */
  readonly sample: Array<{ slug: string; sourceUrl: string }>;
}

/**
 * The backfill: read the page of every active product that has no product
 * code yet. A plan contacts nothing and writes nothing.
 *
 * Unlike a sync it has no per-run cap of its own — being asked to read them
 * all is the point — so `limit` is how a caller bounds it. The fetcher's
 * spacing still applies to every request, and pages are read one at a time.
 */
export async function runCatalogEnrich(
  options: CatalogEnrichOptions,
): Promise<CatalogEnrichResult> {
  const { config, db, fetcher } = options;
  const logger = (options.logger ?? silentLogger).child({ job: "catalog-enrich" });
  const apply = options.apply ?? false;

  const site = await ensureSourceSite(db, {
    key: config.sourceKey,
    name: config.sourceName,
    baseUrl: config.baseUrl,
    canonicalHost: config.canonicalHost,
  });

  const before = await countProductCodes(db, site.id);
  const limit =
    options.limit !== undefined && options.limit >= 0 ? Math.floor(options.limit) : undefined;
  const targets = await loadProductsWithoutCode(db, site.id, limit);
  const sample = targets.slice(0, 10).map(({ slug, sourceUrl }) => ({ slug, sourceUrl }));

  if (!apply || targets.length === 0) {
    return {
      applied: false,
      before,
      after: before,
      selected: targets.length,
      requests: 0,
      enriched: 0,
      failed: 0,
      deferred: 0,
      halted: false,
      failures: [],
      skuChanges: [],
      sharedCodes: await loadSharedProductCodes(db, site.id),
      sample,
    };
  }

  logger.info("enrich.backfill_started", { selected: targets.length });
  // The source has answered unknown routes with its home page before; learn
  // what that looks like first, so such an answer is not stored as a product.
  await fetcher.calibrateSoft404();

  const reader = new ProductPageReader({ fetcher, config, logger, budget: targets.length });
  const summary = await enrichProducts({ db, reader, targets, logger });
  const failures = reader.failures;
  await recordReadFailures(db, failures, { sourceSiteId: site.id, kind: "enrich_backfill" });

  const after = await countProductCodes(db, site.id);
  logger.info("enrich.backfill_completed", {
    requests: reader.requests,
    enriched: summary.enriched,
    failed: summary.failed,
    deferred: summary.deferred,
    halted: reader.halted,
    withoutCode: after.withoutCode,
  });

  return {
    applied: true,
    before,
    after,
    selected: targets.length,
    requests: reader.requests,
    enriched: summary.enriched,
    failed: summary.failed,
    deferred: summary.deferred,
    halted: reader.halted,
    failures,
    skuChanges: summary.skuChanges,
    sharedCodes: await loadSharedProductCodes(db, site.id),
    sample,
  };
}
