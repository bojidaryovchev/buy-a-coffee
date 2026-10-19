import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { products } from "@catalog/db/schema";
import {
  normalizeForComparison,
  packQuantityLabel,
  packServings,
  productKind,
} from "@catalog/shared";
import { auditGeneratedCopy } from "./audit.ts";
import {
  type CopyResearch,
  type CopyWorkItem,
  type GeneratedCopy,
  type ProductAnswer,
  copyOutputEnvelopeSchema,
  productAnswerSchema,
} from "./contract.ts";
import { type CopyCandidate, type RejectedPack, copySourceHash, researchBasis } from "./select.ts";

/**
 * From the model's answer to database rows.
 *
 * Split in two so the judgement can be tested without a database:
 * `reviewBatch` validates the answer, audits each text and decides each pack
 * correction (its only I/O is the injected check of the cited pages), and
 * `writeDecisions` only executes what it decided. Nothing the model returns
 * reaches the database without passing through `reviewBatch`.
 */

/** A pack correction is applied without a person only on this much evidence. */
export const MIN_INDEPENDENT_SOURCES = 2;

/** The supplier, and us: their word on a product is not independent evidence. */
const NOT_EVIDENCE = /kafezona|buy-a-coffee/i;

/**
 * Hosts that publish anyone's words - archives, blogs, social sites - or
 * proxies of other pages: not a shop or a maker stating a size.
 */
const USER_CONTENT = new Set([
  "archive.org",
  "archive.ph",
  "archive.today",
  "archive.is",
  "googleusercontent.com",
  "translate.goog",
  "blogspot.com",
  "wordpress.com",
  "medium.com",
  "github.io",
  "sites.google.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "pinterest.com",
  "tiktok.com",
  "youtube.com",
  "x.com",
  "twitter.com",
]);

/** Second-level labels under which a country's domains are registered (`shop.co.uk`). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or"]);

/**
 * Sizes a pack of anything this shop sells could be. A "correction" outside
 * them is a misreading (a carton of 6 tins read as 6 pods, grams per cup read
 * as grams per pack), and is left for the owner.
 */
const PLAUSIBLE_PACK: Record<string, { min: number; max: number }> = {
  g: { min: 20, max: 5000 },
  ml: { min: 50, max: 5000 },
  pc: { min: 2, max: 2000 },
};

/** How confidence and units read in the reasons the owner sees. */
const CONFIDENCE_LABEL: Record<string, string> = { high: "висока", medium: "средна", low: "ниска" };
const UNIT_LABELS: Record<string, string> = { g: "г", ml: "мл", pc: "бр." };
const unitLabel = (unit: string) => UNIT_LABELS[unit] ?? unit;

/** A correction that changes the size more than this many times is suspicious. */
const MAX_CORRECTION_FACTOR = 20;

/** What `facts_research` holds: the check, and what was done with it. */
export interface FactsResearchRecord {
  readonly version: 2;
  /** `researchBasis` of the supplier's statements when they were checked. */
  readonly basis: string;
  readonly checkedAt: string;
  readonly model: string;
  readonly reasons: readonly string[];
  /** The pack before the check, as stored. */
  readonly before: { readonly value: string; readonly unit: string } | null;
  readonly verdict: CopyResearch["verdict"];
  readonly pack: CopyResearch["pack"];
  readonly findings: CopyResearch["findings"];
  readonly note: string;
  /** Whether the size found was written to the product. */
  readonly applied: boolean;
  /** When a different size was found but not applied: why not. */
  readonly heldBack: string | null;
  /** Sizes the owner turned down, carried from record to record. */
  readonly rejected: readonly RejectedPack[];
}

export interface PackCorrection {
  readonly value: string;
  readonly unit: string;
  readonly servings: string | null;
  readonly servingsEstimated: boolean | null;
}

export type CopyDecision =
  | {
      readonly status: "accepted";
      readonly summary: string;
      readonly html: string;
      readonly hash: string;
    }
  | { readonly status: "rejected"; readonly problems: readonly string[] }
  | { readonly status: "not-asked" };

export type ResearchDecision =
  | {
      readonly status: "recorded";
      readonly record: FactsResearchRecord;
      readonly pack: PackCorrection | null;
    }
  | { readonly status: "missing"; readonly problem: string }
  | { readonly status: "not-asked" };

export interface ProductDecision {
  readonly id: string;
  readonly slug: string;
  readonly copy: CopyDecision;
  readonly research: ResearchDecision;
}

export interface BatchReview {
  readonly decisions: readonly ProductDecision[];
  /** Ids in the answer that were not in the batch - ignored, but worth a log line. */
  readonly strayIds: readonly string[];
}

/**
 * Opens the cited pages and says whether enough of them state the size: null
 * when they do, otherwise why not.
 */
export type SourceCheck = (pack: NonNullable<CopyResearch["pack"]>) => Promise<string | null>;

export interface ReviewContext {
  readonly candidates: ReadonlyMap<string, CopyCandidate>;
  /** Normalised published summary -> the product wearing it. Updated as texts are accepted. */
  readonly summaries: Map<string, string>;
  /** Published bodies by product id. Updated as texts are accepted. */
  readonly bodies: Map<string, readonly string[]>;
  readonly model: string;
  readonly now: Date;
  readonly checkSources: SourceCheck;
}

/** The same markup `copy:apply` writes: plain paragraphs, escaped. */
export function paragraphsToHtml(paragraphs: readonly string[]): string {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return paragraphs.map((paragraph) => `<p>${escape(paragraph)}</p>`).join("\n");
}

/** The site a host belongs to: `www.shop.example.de` -> `example.de`, `a.shop.co.uk` -> `shop.co.uk`. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const take =
    (labels.at(-1) as string).length === 2 && SECOND_LEVEL.has(labels.at(-2) as string) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Distinct sites among `urls` that count as independent evidence. */
export function independentHosts(urls: readonly string[]): string[] {
  const sites = new Set<string>();
  for (const url of urls) {
    if (NOT_EVIDENCE.test(url)) continue;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const site = siteOf(host);
    const fullHost = host.toLowerCase().replace(/\.+$/, "");
    const userContent = [...USER_CONTENT].some(
      (entry) => fullHost === entry || fullHost.endsWith(`.${entry}`),
    );
    if (userContent) continue;
    sites.add(site);
  }
  return [...sites];
}

/**
 * The size as it will be stored: whole grams, millilitres and pieces. The
 * column keeps four decimals, and a fingerprint of "340.1942775" against a
 * stored "340.1943" would differ forever.
 */
export function roundedPack(value: number): number {
  return Math.round(value);
}

/**
 * Whether the size research found differs from the one stored.
 *
 * Compared with the stored size, not with the model's verdict: the verdict
 * is about the label it was shown, and a stored size the listing got wrong
 * (a pack field of 100 under a name saying 16) can be "confirmed" at 16 and
 * still need correcting.
 */
export function differsFromStored(
  pack: NonNullable<CopyResearch["pack"]>,
  current: { value: string | null; unit: string | null },
): boolean {
  if (current.value === null || current.unit === null) return true;
  return current.unit !== pack.unit || Number(current.value) !== roundedPack(pack.value);
}

/**
 * Whether a size that differs from the stored one may replace it without a
 * person.
 *
 * Returns the reason it may not, or null when it may. Deliberately strict: a
 * wrong automatic correction is the very error this exists to fix, so
 * anything short of a confident, independently sourced, plausible change of
 * the figure alone is recorded for the owner and changes nothing. Changing
 * the unit, or giving a product its first size, is always a person's call.
 */
export function correctionHeldBack(
  research: CopyResearch,
  current: { value: string | null; unit: string | null },
  rejected: readonly RejectedPack[] = [],
): string | null {
  const pack = research.pack;
  if (!pack) return "проверката не посочва размер";
  const value = roundedPack(pack.value);
  if (research.verdict === "inconclusive") return "проверката е неубедителна";
  if (pack.confidence !== "high") return `увереността е ${CONFIDENCE_LABEL[pack.confidence]}`;
  if (rejected.some((entry) => entry.unit === pack.unit && entry.value === value)) {
    return "собственикът избра размера на доставчика пред този";
  }
  if (current.value === null || current.unit === null) {
    return "няма записан размер; първият се потвърждава от човек";
  }
  if (current.unit !== pack.unit)
    return `мерната единица би се сменила от ${unitLabel(current.unit)} на ${unitLabel(pack.unit)}`;
  const hosts = independentHosts(pack.sources);
  if (hosts.length < MIN_INDEPENDENT_SOURCES) {
    return `${hosts.length} ${hosts.length === 1 ? "независим източник" : "независими източника"} (нужни са ${MIN_INDEPENDENT_SOURCES})`;
  }
  const range = PLAUSIBLE_PACK[pack.unit];
  if (!range || value < range.min || value > range.max) {
    return `${value} ${unitLabel(pack.unit)} не е правдоподобна опаковка`;
  }
  const before = Number(current.value);
  if (before > 0) {
    const factor = Math.max(value / before, before / value);
    if (factor > MAX_CORRECTION_FACTOR) return `размерът би се променил ${Math.round(factor)} пъти`;
  }
  return null;
}

function reviewCopy(
  item: CopyWorkItem,
  copy: GeneratedCopy | null,
  pack: { label: string | null; mayState: boolean },
  hash: string,
  context: ReviewContext,
): CopyDecision {
  if (!item.task.writeCopy) return { status: "not-asked" };
  if (!copy) return { status: "rejected", problems: ["не беше върнат текст"] };
  const audit = auditGeneratedCopy(item, copy, pack, context);
  if (!audit.ok) return { status: "rejected", problems: audit.problems };
  const body = copy.body.map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    status: "accepted",
    summary: copy.summary.trim(),
    html: paragraphsToHtml(body),
    hash,
  };
}

/** Parse each product's answer on its own: one product's slip costs only that product. */
function parseAnswers(
  items: readonly CopyWorkItem[],
  rawOutput: unknown,
):
  | { answers: Map<string, ProductAnswer>; problems: Map<string, string>; strayIds: string[] }
  | string {
  const envelope = copyOutputEnvelopeSchema.safeParse(rawOutput);
  if (!envelope.success) return "отговорът не е списък с продукти";

  const asked = new Set(items.map((item) => item.id));
  const answers = new Map<string, ProductAnswer>();
  const problems = new Map<string, string>();
  const strayIds: string[] = [];
  for (const raw of envelope.data.products) {
    const id =
      typeof raw === "object" && raw !== null && typeof (raw as { id?: unknown }).id === "string"
        ? (raw as { id: string }).id
        : null;
    if (id === null || !asked.has(id)) {
      if (id !== null) strayIds.push(id);
      continue;
    }
    // The first answer for an id wins; a repeated id is the model's slip.
    if (answers.has(id) || problems.has(id)) continue;
    const parsed = productAnswerSchema.safeParse(raw);
    if (parsed.success) answers.set(id, parsed.data);
    else {
      problems.set(
        id,
        `отговорът е с грешен формат: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
  }
  return { answers, problems, strayIds };
}

/** Judge one batch's answer. */
export async function reviewBatch(
  items: readonly CopyWorkItem[],
  rawOutput: unknown,
  context: ReviewContext,
): Promise<BatchReview> {
  const parsed = parseAnswers(items, rawOutput);
  if (typeof parsed === "string") {
    return {
      decisions: items.map((item) => ({
        id: item.id,
        slug: item.slug,
        copy: item.task.writeCopy
          ? { status: "rejected", problems: [parsed] }
          : { status: "not-asked" },
        research: item.task.research
          ? { status: "missing", problem: parsed }
          : { status: "not-asked" },
      })),
      strayIds: [],
    };
  }

  const decisions: ProductDecision[] = [];
  for (const item of items) {
    const candidate = context.candidates.get(item.id);
    if (!candidate) throw new Error(`No candidate for ${item.slug}`);
    const answer = parsed.answers.get(item.id);
    const malformed = parsed.problems.get(item.id);

    // Research first: a correction changes the size the copy may state.
    let research: ResearchDecision = { status: "not-asked" };
    let corrected: PackCorrection | null = null;
    let packRule = { label: item.pack.label, mayState: item.pack.mayState };
    if (item.task.research) {
      if (!answer?.research) {
        research = { status: "missing", problem: malformed ?? "не беше върната проверка" };
      } else {
        const found = answer.research;
        const current = { value: candidate.weightValue, unit: candidate.weightUnit };
        const rejected = candidate.research?.rejected ?? [];
        const differs = found.pack !== null && differsFromStored(found.pack, current);
        // Only a size that would change something can be held back.
        let heldBack = differs ? correctionHeldBack(found, current, rejected) : null;
        if (differs && heldBack === null && found.pack) {
          heldBack = await context.checkSources(found.pack);
        }
        if (differs && heldBack === null && found.pack) {
          const value = String(roundedPack(found.pack.value));
          const servings = packServings(value, found.pack.unit, productKind(candidate.name));
          corrected = {
            value,
            unit: found.pack.unit,
            servings: servings?.exact ?? null,
            servingsEstimated: servings?.estimated ?? null,
          };
        }
        research = {
          status: "recorded",
          pack: corrected,
          record: {
            version: 2,
            basis: researchBasis(candidate),
            checkedAt: context.now.toISOString(),
            model: context.model,
            reasons: item.task.researchReasons,
            before:
              candidate.weightValue && candidate.weightUnit
                ? { value: candidate.weightValue, unit: candidate.weightUnit }
                : null,
            verdict: found.verdict,
            pack: found.pack,
            findings: found.findings,
            note: found.note,
            applied: corrected !== null,
            heldBack,
            rejected,
          },
        };
        // This check now decides what the copy may say about the size.
        packRule = corrected
          ? { label: packQuantityLabel(corrected.value, corrected.unit), mayState: true }
          : { label: item.pack.label, mayState: heldBack === null };
      }
    }

    const after = corrected
      ? { ...candidate, weightValue: corrected.value, weightUnit: corrected.unit }
      : candidate;
    const copy =
      item.task.writeCopy && malformed && !answer
        ? ({ status: "rejected", problems: [malformed] } as const)
        : reviewCopy(item, answer?.copy ?? null, packRule, copySourceHash(after), context);
    if (copy.status === "accepted") {
      // Later products in this run must not repeat it.
      context.summaries.set(normalizeForComparison(copy.summary), item.id);
      context.bodies.set(
        item.id,
        (answer?.copy?.body ?? []).map((paragraph) => paragraph.trim()).filter(Boolean),
      );
    }
    decisions.push({ id: item.id, slug: item.slug, copy, research });
  }

  return { decisions, strayIds: parsed.strayIds };
}

export interface WriteSummary {
  readonly copyWritten: number;
  readonly copyRejected: number;
  readonly researched: number;
  readonly packsCorrected: number;
  /** Slugs whose page changed (new text or a corrected size): what to announce. */
  readonly changed: readonly string[];
}

/**
 * Execute the decisions. One transaction per product, so a product never
 * ends up with half of its outcome written.
 *
 * Copy is written only over copy a machine wrote, or over none: the guard is
 * in the statement itself, so a text the owner published between the read
 * and this write is never replaced.
 */
export async function writeDecisions(
  db: Database,
  decisions: readonly ProductDecision[],
  model: string,
): Promise<WriteSummary> {
  let copyWritten = 0;
  let copyRejected = 0;
  let researched = 0;
  let packsCorrected = 0;
  const changed: string[] = [];

  for (const decision of decisions) {
    const problems: string[] = [];
    if (decision.copy.status === "rejected") problems.push(...decision.copy.problems);
    if (decision.research.status === "missing") problems.push(decision.research.problem);

    const research =
      decision.research.status === "recorded"
        ? {
            factsResearch: decision.research.record as unknown as Record<string, unknown>,
            factsCheckedAt: sql`now()`,
            ...(decision.research.pack
              ? {
                  packOverrideValue: decision.research.pack.value,
                  packOverrideUnit: decision.research.pack.unit,
                  weightValue: decision.research.pack.value,
                  weightUnit: decision.research.pack.unit,
                  servings: decision.research.pack.servings,
                  servingsEstimated: decision.research.pack.servingsEstimated,
                }
              : {}),
          }
        : {};

    const outcome =
      problems.length > 0
        ? {
            copyAttempts: sql`least(${products.copyAttempts} + 1, 32767)`,
            copyLastError: [...new Set(problems)].join("; ").slice(0, 2000),
          }
        : { copyAttempts: 0, copyLastError: null };

    const copy = decision.copy;
    const wrote = await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ ...research, ...outcome })
        .where(eq(products.id, decision.id));
      if (copy.status !== "accepted") return false;
      const written = await tx
        .update(products)
        .set({
          descriptionTextOverride: copy.summary,
          descriptionHtmlOverride: copy.html,
          copyOrigin: "ai",
          copySourceHash: copy.hash,
          copyWrittenAt: sql`now()`,
          copyModel: model,
        })
        .where(
          and(
            eq(products.id, decision.id),
            or(
              eq(products.copyOrigin, "ai"),
              and(
                isNull(products.copyOrigin),
                isNull(products.descriptionTextOverride),
                isNull(products.descriptionHtmlOverride),
              ),
            ),
          ),
        )
        .returning({ id: products.id });
      return written.length > 0;
    });

    if (wrote) copyWritten += 1;
    if (wrote || (decision.research.status === "recorded" && decision.research.pack)) {
      changed.push(decision.slug);
    }
    if (copy.status === "rejected") copyRejected += 1;
    if (decision.research.status === "recorded") {
      researched += 1;
      if (decision.research.pack) packsCorrected += 1;
    }
  }

  return { copyWritten, copyRejected, researched, packsCorrected, changed };
}
