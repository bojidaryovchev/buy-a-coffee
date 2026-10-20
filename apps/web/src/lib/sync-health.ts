/**
 * Is the catalog sync healthy? A pure answer, from rows already read.
 *
 * Nothing here touches the database or the clock: the rows, "now" and the
 * thresholds are all arguments. That is what lets every condition be tested by
 * writing the row that causes it, and it is the reason this file does not
 * import `@/lib/db` — the route that wraps it does the reading and the mailing.
 *
 * The sync runs outside the storefront (a scheduled workflow), and in
 * production it once stopped for two months without anyone noticing, because
 * the only thing watching it was the thing that had stopped. This is the
 * watcher that lives somewhere else.
 *
 * A run is judged by its own record. `sync_runs` rows carry more columns than
 * are read here; unknown columns are ignored on purpose, so the sync can grow
 * without this breaking. `sync_changes` is read for one thing only, a
 * product the sync renamed (`evaluateIdentityChanges`). And one condition is
 * about what the sync brought rather than how it ran: a product flagged
 * flavoured that nobody has classified yet (`evaluateUnauditedFlavoured`).
 */
import { coffeeVerdict, noCoffeeHint } from "@/lib/catalog/no-coffee";

export const SYNC_CONDITIONS = [
  "no_recent_success",
  "latest_failed",
  "latest_partial",
  "breaker_open",
  "source_fallback",
  "low_confidence",
  "image_failed",
  "identity_changed",
  "flavoured_unaudited",
] as const;

export type SyncCondition = (typeof SYNC_CONDITIONS)[number];

/**
 * `sync_runs.metadata.kind` of the run `catalog:link` writes when a person
 * links a product to its new source URL by hand. It exists to carry an audit
 * trail, not because the source was read, so it must never count as a sync.
 */
export const MANUAL_LINK_RUN_KIND = "manual_link";

/** A real reading of the source, as opposed to a bookkeeping row beside it. */
export const isManualLinkRun = (run: {
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}): boolean => run.metadata?.kind === MANUAL_LINK_RUN_KIND;

/** The columns of a `sync_runs` row this module reads. */
export interface SyncRunSnapshot {
  readonly status: string;
  readonly dryRun: boolean;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly circuitBreakerTripped: boolean;
  readonly catalogSource: string | null;
  /** Stored as text (`"0.700"`); a number is accepted for convenience. */
  readonly parserConfidence: string | number | null;
  readonly imagesFailed: number;
  /** Optional so a caller that does not read the column still type-checks; a
      run without it is taken to be a reading of the source. */
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SyncHealthThresholds {
  /** How often the sync is scheduled to run. */
  readonly syncIntervalMs: number;
  /** How many intervals may pass without a success before it is an alarm. */
  readonly missedIntervals: number;
  /** Allowance on top, because scheduled workflows start late — sometimes by
      the better part of an hour — and one late run is not an outage. */
  readonly slackMs: number;
  /** Below this the parser is guessing. Looser than the breaker's own floor,
      deliberately: this is the early warning, the breaker is the brake. */
  readonly minParserConfidence: number;
  /** The catalog source a healthy run reports. */
  readonly expectedCatalogSource: string;
}

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SYNC_HEALTH_THRESHOLDS: SyncHealthThresholds = {
  syncIntervalMs: 6 * HOUR_MS,
  missedIntervals: 2,
  slackMs: 2 * HOUR_MS,
  minParserConfidence: 0.9,
  expectedCatalogSource: "filter_init",
};

export interface SyncHealthFinding {
  readonly condition: SyncCondition;
  /** Operational, never customer data: it goes into a notification. */
  readonly summary: string;
}

/** Short names, for notification subjects. */
export const SYNC_CONDITION_LABEL: Record<SyncCondition, string> = {
  no_recent_success: "няма успешна синхронизация",
  latest_failed: "последната синхронизация е неуспешна",
  latest_partial: "последната синхронизация е частична",
  breaker_open: "предпазителят е отворен",
  source_fallback: "каталогът идва от резервния източник",
  low_confidence: "ниска сигурност на разчитането",
  image_failed: "снимки, които не са свалени",
  identity_changed: "продукт със сменено име",
  flavoured_unaudited: "ароматизиран продукт за проверка",
};

const isFinished = (run: SyncRunSnapshot): boolean => run.status !== "running";

const finishedAt = (run: SyncRunSnapshot): Date => run.completedAt ?? run.startedAt;

const hours = (ms: number): string =>
  String(Math.round((ms / HOUR_MS) * 10) / 10).replace(".", ",");

function confidenceOf(run: SyncRunSnapshot): number | null {
  if (run.parserConfidence === null) return null;
  const value =
    typeof run.parserConfidence === "number" ? run.parserConfidence : Number(run.parserConfidence);
  return Number.isFinite(value) ? value : null;
}

/**
 * The conditions that hold right now, in a fixed order, each at most once.
 *
 * Dry runs are ignored throughout: they write nothing, are started by a person,
 * and a successful one must not hide that the real schedule has stopped. So are
 * manual links (`isManualLinkRun`), for the same reason: a person's one-off,
 * not the schedule. A run
 * still `running` is not a verdict either — it has no outcome to judge yet, and
 * a run that never finishes shows up as the absence of a success.
 *
 * An empty history is `no_recent_success`: a catalog that has never been
 * synchronised is exactly as stale as one that stopped.
 */
export function evaluateSyncHealth(
  runs: readonly SyncRunSnapshot[],
  now: Date,
  thresholds: SyncHealthThresholds = DEFAULT_SYNC_HEALTH_THRESHOLDS,
): SyncHealthFinding[] {
  /* A manual link is dropped before anything else is judged, not just from the
     "last success" rule: it succeeds instantly by construction, and as the
     newest row it would otherwise become the "latest run" and hide a failed
     real sync behind a clean-looking one. */
  const real = runs
    .filter((run) => !run.dryRun && isFinished(run) && !isManualLinkRun(run))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const findings: SyncHealthFinding[] = [];
  const add = (condition: SyncCondition, summary: string) => findings.push({ condition, summary });

  const window = thresholds.syncIntervalMs * thresholds.missedIntervals + thresholds.slackMs;
  const lastSuccess = real
    .filter((run) => run.status === "succeeded" && !run.circuitBreakerTripped)
    .map((run) => finishedAt(run).getTime())
    .reduce<number | null>((best, at) => (best === null || at > best ? at : best), null);

  if (lastSuccess === null) {
    add(
      "no_recent_success",
      real.length === 0
        ? "Няма записана нито една синхронизация."
        : "Няма нито една успешна синхронизация в записаната история.",
    );
  } else if (now.getTime() - lastSuccess > window) {
    add(
      "no_recent_success",
      `Последната успешна синхронизация е отпреди ${hours(now.getTime() - lastSuccess)} ч.; ` +
        `допустимото е ${hours(window)} ч.`,
    );
  }

  const latest = real[0];
  if (!latest) return findings;

  if (latest.status === "failed" || latest.status === "aborted") {
    add("latest_failed", "Последната синхронизация е завършила с грешка.");
  }
  if (latest.status === "partial") {
    add("latest_partial", "Последната синхронизация е завършила частично.");
  }
  if (latest.circuitBreakerTripped) {
    add("breaker_open", "Предпазителят е отворен: каталогът е запазен, нищо не е премахнато.");
  }
  if (latest.catalogSource !== null && latest.catalogSource !== thresholds.expectedCatalogSource) {
    add(
      "source_fallback",
      `Каталогът е прочетен от „${latest.catalogSource}“, а не от „${thresholds.expectedCatalogSource}“.`,
    );
  }

  const confidence = confidenceOf(latest);
  if (confidence !== null && confidence < thresholds.minParserConfidence) {
    add(
      "low_confidence",
      `Сигурността на разчитането е ${confidence.toFixed(2)}, под ${thresholds.minParserConfidence.toFixed(2)}.`,
    );
  }
  if (latest.imagesFailed > 0) {
    add(
      "image_failed",
      `Снимки, които не са свалени при последната синхронизация: ${latest.imagesFailed}.`,
    );
  }

  return findings;
}

/**
 * A product the sync renamed: one `sync_changes` row of an update, as read.
 * `before` and `after` are the sync's own snapshots (`productSnapshot` in
 * `@catalog/scraper-core`); only `name` and `currentPrice` are read.
 */
export interface IdentityChangeSnapshot {
  readonly sourceKey: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

/** How many renamed products the summary names before it only counts. */
const IDENTITY_NAMED = 5;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * A product the sync renamed, as a finding — or null for none.
 *
 * The sync keys a product by its address at the source and pack size. Where
 * the source lists two products at one address, it keeps the first and drops
 * the second (research 08 §1.4, until the sync's own fix): if the source ever
 * lists them the other way round, the existing product takes the other one's
 * name and price — under its old URL, its old slug, and its own order history.
 * The sync reports that as an ordinary update. A rename is rare on its own, so
 * every one is named for a person to check; a product whose identity really
 * changed is then caught the day it happens instead of by a customer.
 *
 * Read-only: it reads what the sync already records, and changes nothing the
 * sync does.
 */
export function evaluateIdentityChanges(
  changes: readonly IdentityChangeSnapshot[],
  /** `more`: the read stopped at its limit, so there may be more than were read. */
  options: { readonly more?: boolean } = {},
): SyncHealthFinding | null {
  const renamed = changes.flatMap((change) => {
    const before = text(change.before?.name);
    const after = text(change.after?.name);
    if (!before || !after || before === after) return [];
    const price = (snapshot: IdentityChangeSnapshot["before"]) => text(snapshot?.currentPrice);
    const was = price(change.before);
    const now = price(change.after);
    return [
      `„${before}“ → „${after}“${was && now && was !== now ? ` (цена ${was} → ${now})` : ""}`,
    ];
  });
  if (renamed.length === 0) return null;

  const named = renamed.slice(0, IDENTITY_NAMED).join("; ");
  const rest = renamed.length - IDENTITY_NAMED;
  const more =
    rest > 0
      ? ` и още ${options.more ? "поне " : ""}${rest}`
      : options.more
        ? " и може би още"
        : "";
  return {
    condition: "identity_changed",
    summary:
      `Синхронизацията смени името на продукт под същия адрес: ${named}${more}. ` +
      "Проверете, че е същият продукт, а не друг на негово място.",
  };
}

/** A product on sale flagged flavoured, as the audit check reads it. */
export interface FlavouredProductSnapshot {
  readonly slug: string;
  readonly previousSlugs: readonly string[];
  /** The supplier's name: what the owner sees in the panel and the snapshot. */
  readonly name: string;
  /** The stored descriptions, the supplier's and ours, as text or HTML. */
  readonly descriptions: readonly string[];
}

/**
 * The flagged products nobody has filed as coffee or as not coffee
 * (`content/no-coffee.ts`). The flavoured page holds each of them back until
 * someone does.
 */
export const unauditedFlavoured = (
  products: readonly FlavouredProductSnapshot[],
): FlavouredProductSnapshot[] =>
  products.filter(
    (product) => coffeeVerdict([product.slug, ...product.previousSlugs]) === "unaudited",
  );

/** How many held-back products the summary names before it only counts. */
const UNAUDITED_NAMED = 10;

/**
 * Products held back from the flavoured page, as a finding — or null for
 * none.
 *
 * Each is named with its slug, which is what the audit is keyed by, and with
 * what its description suggests when it suggests anything („описанието казва
 * „без кафе““): a hint for the person classifying it, never a verdict. The
 * products are the ones being raised now; `alreadyRaised` counts those still
 * waiting from an earlier mail, which are mentioned and not named again.
 */
export function evaluateUnauditedFlavoured(
  products: readonly FlavouredProductSnapshot[],
  options: { readonly alreadyRaised?: number } = {},
): SyncHealthFinding | null {
  if (products.length === 0) return null;

  const named = products
    .slice(0, UNAUDITED_NAMED)
    .map((product) => {
      const hint = product.descriptions
        .map((text) => noCoffeeHint(text))
        .find((found) => found !== null);
      return `„${product.name}“ (${product.slug})${hint ? ` — описанието казва „${hint}“` : ""}`;
    })
    .join("; ");
  const rest = products.length - UNAUDITED_NAMED;
  const one = products.length === 1;
  const waiting = options.alreadyRaised ?? 0;

  return {
    condition: "flavoured_unaudited",
    summary:
      (one
        ? "Ароматизиран продукт, за който още не е проверено дали съдържа кафе, не се показва на страницата „Ароматизирано кафе“: "
        : "Ароматизирани продукти, за които още не е проверено дали съдържат кафе, не се показват на страницата „Ароматизирано кафе“: ") +
      `${named}${rest > 0 ? ` и още ${rest}` : ""}. ` +
      (one
        ? "Прочетете описанието му и го запишете в apps/web/content/no-coffee.ts: във FLAVOURED_COFFEE, ако е кафе — тогава се показва, — или в NO_COFFEE, ако не е."
        : "Прочетете описанията им и запишете всеки в apps/web/content/no-coffee.ts: във FLAVOURED_COFFEE, ако е кафе — тогава се показва, — или в NO_COFFEE, ако не е.") +
      (waiting > 0
        ? ` Още ${waiting} от предишно известие също чака${waiting === 1 ? "" : "т"} проверка.`
        : ""),
  };
}
