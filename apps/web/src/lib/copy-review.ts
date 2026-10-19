import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { products } from "@catalog/db/schema";
import { db } from "@/lib/db";

/**
 * What the admin's "Текстове" screen reads: the catalog copywriter's work.
 *
 * The copywriter (`pnpm catalog:copy`, after every sync) writes descriptions
 * for products the curated file does not cover and researches pack sizes that
 * look wrong. Everything it does is recorded on the product row - who wrote
 * the copy (`copy_origin`), its failures (`copy_attempts`, `copy_last_error`)
 * and every check of the facts (`facts_research`) - so this screen only reads
 * those columns. See `packages/scraper-core/src/catalog/copywriter/`.
 */

/** Mirrors `MAX_COPY_ATTEMPTS` in the copywriter: past it, a product is left for the owner. */
export const COPY_GIVE_UP_AFTER = 3;

export interface CopyCounts {
  readonly hand: number;
  readonly ai: number;
  readonly edited: number;
  /** Active products still on the generated one-sentence description. */
  readonly none: number;
  readonly givenUp: number;
}

export interface CopyRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly origin: "ai" | "edited";
  readonly summary: string;
  /** The body as plain paragraphs, for the edit form. */
  readonly paragraphs: readonly string[];
  readonly model: string | null;
  readonly writtenAt: Date | null;
}

export interface FailingRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface ResearchedPack {
  readonly value: number;
  readonly unit: string;
  readonly confidence: string;
  readonly sources: readonly string[];
}

export interface ResearchRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly checkedAt: Date | null;
  readonly verdict: string;
  readonly applied: boolean;
  readonly heldBack: string | null;
  readonly reasons: readonly string[];
  readonly before: { readonly value: string; readonly unit: string } | null;
  readonly pack: ResearchedPack | null;
  readonly findings: ReadonlyArray<{
    readonly field: string;
    readonly ours: string | null;
    readonly found: string;
    readonly confidence: string;
    readonly sources: readonly string[];
  }>;
  readonly note: string;
  /** The size in force because of research, if any. */
  readonly override: { readonly value: string; readonly unit: string } | null;
}

export interface CopyReview {
  readonly counts: CopyCounts;
  readonly recent: readonly CopyRow[];
  readonly failing: readonly FailingRow[];
  readonly research: readonly ResearchRow[];
}

/** `<p>` paragraphs, as the copywriter and `copy:apply` write them, back to text. */
export function htmlToParagraphs(html: string | null): string[] {
  if (!html) return [];
  return [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((match) =>
      (match[1] as string)
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim(),
    )
    .filter(Boolean);
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Read a stored `facts_research` defensively: it is JSON written by a past version. */
export function readResearch(
  raw: unknown,
): Omit<ResearchRow, "id" | "slug" | "name" | "checkedAt" | "override"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const pack = record.pack as Record<string, unknown> | null | undefined;
  const before = record.before as Record<string, unknown> | null | undefined;
  return {
    verdict: typeof record.verdict === "string" ? record.verdict : "inconclusive",
    applied: record.applied === true,
    heldBack: typeof record.heldBack === "string" ? record.heldBack : null,
    reasons: asStrings(record.reasons),
    before:
      before && typeof before.value === "string" && typeof before.unit === "string"
        ? { value: before.value, unit: before.unit }
        : null,
    pack:
      pack && typeof pack.value === "number" && typeof pack.unit === "string"
        ? {
            value: pack.value,
            unit: pack.unit,
            confidence: typeof pack.confidence === "string" ? pack.confidence : "low",
            sources: asStrings(pack.sources),
          }
        : null,
    findings: Array.isArray(record.findings)
      ? record.findings.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return [];
          const finding = entry as Record<string, unknown>;
          if (typeof finding.field !== "string" || typeof finding.found !== "string") return [];
          return [
            {
              field: finding.field,
              ours: typeof finding.ours === "string" ? finding.ours : null,
              found: finding.found,
              confidence: typeof finding.confidence === "string" ? finding.confidence : "low",
              sources: asStrings(finding.sources),
            },
          ];
        })
      : [],
    note: typeof record.note === "string" ? record.note : "",
  };
}

export async function loadCopyReview(): Promise<CopyReview> {
  const active = eq(products.status, "active");
  const [[counts], recent, failing, researched] = await Promise.all([
    db
      .select({
        hand: sql<number>`count(*) filter (where ${products.copyOrigin} = 'hand')::int`,
        ai: sql<number>`count(*) filter (where ${products.copyOrigin} = 'ai')::int`,
        edited: sql<number>`count(*) filter (where ${products.copyOrigin} = 'edited')::int`,
        none: sql<number>`count(*) filter (where ${products.descriptionTextOverride} is null)::int`,
        givenUp: sql<number>`count(*) filter (where ${products.copyAttempts} >= ${COPY_GIVE_UP_AFTER})::int`,
      })
      .from(products)
      .where(active),
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        origin: products.copyOrigin,
        summary: products.descriptionTextOverride,
        html: products.descriptionHtmlOverride,
        model: products.copyModel,
        writtenAt: products.copyWrittenAt,
      })
      .from(products)
      .where(and(active, inArray(products.copyOrigin, ["ai", "edited"])))
      .orderBy(sql`${products.copyWrittenAt} desc nulls last`)
      .limit(40),
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        attempts: products.copyAttempts,
        lastError: products.copyLastError,
      })
      .from(products)
      .where(and(active, gt(products.copyAttempts, 0)))
      .orderBy(desc(products.copyAttempts), products.name)
      .limit(50),
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        checkedAt: products.factsCheckedAt,
        research: products.factsResearch,
        overrideValue: products.packOverrideValue,
        overrideUnit: products.packOverrideUnit,
      })
      .from(products)
      .where(
        and(
          active,
          isNotNull(products.factsResearch),
          // Every check still waiting for a decision, however old, plus the
          // latest of the rest: a pending size must never scroll out of view.
          sql`(
            (${products.factsResearch}->>'heldBack' is not null
              and coalesce((${products.factsResearch}->>'applied')::boolean, false) = false)
            or ${products.id} in (
              select id from products
              where status = 'active' and facts_research is not null
              order by facts_checked_at desc nulls last
              limit 40
            )
          )`,
        ),
      )
      .orderBy(sql`${products.factsCheckedAt} desc nulls last`),
  ]);

  const research = researched.flatMap((row): ResearchRow[] => {
    const parsed = readResearch(row.research);
    if (!parsed) return [];
    return [
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        checkedAt: row.checkedAt,
        ...parsed,
        override:
          row.overrideValue && row.overrideUnit
            ? { value: row.overrideValue, unit: row.overrideUnit }
            : null,
      },
    ];
  });
  // What needs a decision first: a different size found but not applied.
  const waiting = (row: ResearchRow) => Number(!row.applied && row.heldBack !== null);
  research.sort((a, b) => waiting(b) - waiting(a));

  return {
    counts: counts ?? { hand: 0, ai: 0, edited: 0, none: 0, givenUp: 0 },
    recent: recent.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      origin: row.origin === "edited" ? "edited" : "ai",
      summary: row.summary ?? "",
      paragraphs: htmlToParagraphs(row.html),
      model: row.model,
      writtenAt: row.writtenAt,
    })),
    failing,
    research,
  };
}
