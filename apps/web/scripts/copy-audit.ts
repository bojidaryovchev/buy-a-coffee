/**
 * The copy audit, as pure functions.
 *
 * `check-originality.ts` and `copy-todo.ts` are command-line entry points, and
 * an entry point cannot be imported by a test without running it. Everything
 * they decide — what counts as source-derived, what counts as merely missing —
 * lives here instead, where the tests can reach it.
 *
 * Nothing in this file touches the database. It works from the reference
 * artifacts, which are what make the audit runnable in CI.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWeight } from "@catalog/shared";
import type { ProductCopy } from "../content/product-copy.ts";
import { currentSlugsOfSnapshot } from "./catalog-reslug-lib.ts";
import { brandDisplayName } from "../src/lib/catalog/brand-display.ts";
import { type FallbackCopyFacts, composeFallbackCopy } from "../src/lib/catalog/fallback-copy.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REFERENCE_DIR = path.resolve(WEB_ROOT, "../../reference/latest");

/**
 * How much verbatim phrasing a rewrite may share with the source it replaces.
 *
 * Measured as the share of the source's five-word sequences that also appear
 * in ours. Some overlap is unavoidable and correct: "бленд от около 70 %
 * арабика и 30 % робуста" is a fact about the coffee, and there is no honest
 * way to state it that avoids the words. Sustained overlap is not — it means
 * sentences were re-ordered rather than rewritten.
 *
 * 35 % sits above the highest legitimate value in the current catalogue (27 %,
 * a product whose description is almost entirely a blend spec) and well below
 * what a light paraphrase scores.
 */
export const MAX_SOURCE_OVERLAP = 0.35;

/** Five-word window. Long enough that shared phrasing is deliberate. */
export const SHINGLE_SIZE = 5;

/** One product of `reference/latest/products.json`, as far as this audit reads it. */
export interface ReferenceProduct {
  readonly sourceKey: string;
  /**
   * Our identifier, and the join key to `content/product-copy.ts`. Null for a
   * product the crawler has discovered but the sync has not stored yet — and
   * absent altogether in snapshots exported before the field existed.
   */
  readonly slug?: string | null;
  readonly name: string;
  readonly descriptionText: string | null;
  readonly brandKey?: string | null;
  readonly categoryKeys?: readonly string[];
  readonly weight?: string | null;
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface CopyFinding {
  /** Slug, or several for an internal duplicate. */
  readonly key: string;
  readonly name: string;
  readonly detail: string;
}

export interface CopyAudit {
  /** Products in the reference snapshot. */
  readonly checked: number;
  /** Of those, how many have an entry of their own and were compared. */
  readonly compared: number;
  /** Failures: duplicated or source-derived copy. */
  readonly findings: readonly CopyFinding[];
  /**
   * Products with no entry. Not a failure — they publish the generated
   * sentence, which contains none of the source's prose by construction.
   */
  readonly withoutCopy: readonly ReferenceProduct[];
  /**
   * Entries whose slug is not in the snapshot. Not a failure either, but not
   * nothing: that copy could not be compared against the source's text.
   */
  readonly unverifiedEntries: readonly string[];
}

/** Fold to comparable words: case, punctuation and spacing carry no meaning here. */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(text: string, size: number = SHINGLE_SIZE): Set<string> {
  const words = normalizeForComparison(text).split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) {
    result.add(words.slice(i, i + size).join(" "));
  }
  return result;
}

/** Share of `source`'s phrasing that reappears in `ours`. */
export function overlapRatio(source: string, ours: string): number {
  const from = shingles(source);
  if (from.size === 0) return 0;
  const to = shingles(ours);
  let shared = 0;
  for (const shingle of from) if (to.has(shingle)) shared += 1;
  return shared / from.size;
}

/**
 * Compare our copy against the source descriptions the crawler recorded.
 *
 * Three outcomes are kept apart on purpose:
 *
 *  - **Findings fail the build.** Copy that tracks the source's phrasing, a
 *    summary that *is* the source's description, and one summary shared by two
 *    of our own products.
 *  - **A product with no copy is counted, not failed.** It used to fail,
 *    because a product without an entry published the source's description.
 *    It no longer can: it publishes the generated sentence. And the sync adds
 *    products on its own schedule — a check that goes red because the catalog
 *    grew is a check people learn to ignore.
 *  - **An entry the snapshot cannot place is reported.** Its text was not
 *    compared with anything, and saying so is better than a silent pass.
 */
export function auditProductCopy(
  sourceProducts: readonly ReferenceProduct[],
  copy: Readonly<Record<string, ProductCopy>>,
): CopyAudit {
  const findings: CopyFinding[] = [];
  const withoutCopy: ReferenceProduct[] = [];
  const seenSlugs = new Set<string>();
  let compared = 0;

  /*
   * The join is by slug, so a snapshot without slugs joins nothing: every
   * product would land in "no copy yet" and the check would pass having
   * compared no text at all. That is the one way this audit could go quiet
   * while looking healthy, so it is a failure in its own right.
   */
  const snapshotHasSlugs = sourceProducts.some((product) => Boolean(product.slug));
  if (sourceProducts.length > 0 && Object.keys(copy).length > 0 && !snapshotHasSlugs) {
    findings.push({
      key: "reference/latest/products.json",
      name: "(snapshot)",
      detail:
        "no product in the snapshot carries a `slug`, so our copy cannot be matched to the source's text — re-export the reference artifacts with slugs",
    });
  }

  for (const product of sourceProducts) {
    const slug = product.slug ?? null;
    if (slug) seenSlugs.add(slug);
    const ours = slug && Object.hasOwn(copy, slug) ? copy[slug] : undefined;

    if (!slug || !ours) {
      withoutCopy.push(product);
      continue;
    }
    compared += 1;

    const sourceText = product.descriptionText?.trim();
    if (!sourceText) continue;

    const ourText = `${ours.summary} ${ours.body.join(" ")}`;
    const ratio = overlapRatio(sourceText, ourText);
    if (ratio > MAX_SOURCE_OVERLAP) {
      findings.push({
        key: slug,
        name: product.name,
        detail: `${Math.round(ratio * 100)}% of the source's phrasing survives (limit ${Math.round(
          MAX_SOURCE_OVERLAP * 100,
        )}%) — rewrite, do not re-order`,
      });
    }

    if (normalizeForComparison(ours.summary) === normalizeForComparison(sourceText)) {
      findings.push({
        key: slug,
        name: product.name,
        detail: "summary is the source description verbatim",
      });
    }
  }

  /*
   * Our own copy repeated across two of our own products is the same problem
   * pointed inward — two URLs on this domain competing with identical text.
   * It happens naturally: the source gives one description to a coffee sold in
   * two pack sizes, and the obvious move is to paste the rewrite into both.
   */
  const summaries = new Map<string, string[]>();
  for (const [slug, entry] of Object.entries(copy)) {
    const key = normalizeForComparison(entry.summary);
    summaries.set(key, [...(summaries.get(key) ?? []), slug]);
  }
  for (const [, slugs] of summaries) {
    if (slugs.length < 2) continue;
    findings.push({
      key: slugs.join(", "),
      name: "(internal duplicate)",
      detail: `${slugs.length} products share one summary — give each its own`,
    });
  }

  const unverifiedEntries = snapshotHasSlugs
    ? Object.keys(copy).filter((slug) => !seenSlugs.has(slug))
    : [];

  return { checked: sourceProducts.length, compared, findings, withoutCopy, unverifiedEntries };
}

/**
 * The facts the fallback sentence is built from, read off a snapshot product.
 *
 * The storefront builds the same facts from database columns
 * (`lib/catalog/queries.ts`). This is that mapping for the artifact shape, so
 * the sentence can be reproduced — and tested against the source's text —
 * with no database. `descriptionText` is conspicuously not read.
 */
export function referenceProductFacts(
  product: ReferenceProduct,
  brandNames: ReadonlyMap<string, string> = new Map(),
): FallbackCopyFacts {
  const weight = parseWeight(product.weight ?? null);
  return {
    brandName: product.brandKey ? (brandNames.get(product.brandKey) ?? null) : null,
    categoryKeys: product.categoryKeys ?? [],
    packValue: weight?.value ?? null,
    packUnit: weight?.unit ?? null,
    attributes: product.attributes ?? {},
  };
}

export function generatedSentenceFor(
  product: ReferenceProduct,
  brandNames?: ReadonlyMap<string, string>,
): string | null {
  return composeFallbackCopy(referenceProductFacts(product, brandNames));
}

export interface ReferenceSnapshot {
  readonly products: readonly ReferenceProduct[];
  /**
   * Brand display name by the `brandKey` products carry — the name the page
   * shows (`brandDisplayName`), not the supplier's capitals, so a sentence
   * printed here reads as it does on the storefront.
   */
  readonly brandNames: ReadonlyMap<string, string>;
}

/** Null when the artifacts have not been exported — a fresh clone, typically. */
export async function loadReferenceSnapshot(
  directory: string = REFERENCE_DIR,
): Promise<ReferenceSnapshot | null> {
  let rawProducts: string;
  try {
    rawProducts = await readFile(path.join(directory, "products.json"), "utf8");
  } catch {
    return null;
  }
  const exported = (JSON.parse(rawProducts) as { products?: ReferenceProduct[] }).products ?? [];

  const brandNames = new Map<string, string>();
  let brands: Array<{ sourceKey: string; name: string }> = [];
  try {
    const rawBrands = await readFile(path.join(directory, "brands.json"), "utf8");
    brands =
      (JSON.parse(rawBrands) as { brands?: Array<{ sourceKey: string; name: string }> }).brands ??
      [];
    for (const brand of brands) {
      brandNames.set(
        brand.sourceKey,
        brandDisplayName({ name: brand.name, sourceKey: brand.sourceKey }),
      );
    }
  } catch {
    // Brands are optional here: without them the sentence simply names none.
  }

  /*
   * Each product at the slug it has on the storefront today. The snapshot
   * records the slug a product had when it was exported, and our copy is keyed
   * by where the product is now; `currentSlugsOfSnapshot` is the plan the
   * catalog was moved by, so the join below is to the right entry whether the
   * snapshot was exported before the move or after it.
   */
  const current = currentSlugsOfSnapshot(exported, brands);
  const products = exported.map((product) =>
    product.slug ? { ...product, slug: current.get(product.slug) ?? product.slug } : product,
  );

  return { products, brandNames };
}

/** A page of `pages.json`, as far as its text goes. */
export interface ReferencePage {
  readonly pageType?: string;
  readonly path?: string;
  readonly metaDescription?: string | null;
  readonly isSoft404?: boolean;
}

/** The crawl's pages, or none when `pages.json` has not been exported. */
export async function loadReferencePages(
  directory: string = REFERENCE_DIR,
): Promise<readonly ReferencePage[]> {
  try {
    const raw = await readFile(path.join(directory, "pages.json"), "utf8");
    return (JSON.parse(raw) as { pages?: ReferencePage[] }).pages ?? [];
  } catch {
    return [];
  }
}
