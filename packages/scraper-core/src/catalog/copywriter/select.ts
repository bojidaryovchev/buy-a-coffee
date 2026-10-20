import { sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import {
  packQuantityLabel,
  packServings,
  parsePackSizeConflict,
  pricePerServing,
  productKind,
  productName,
  stripTrailingZeros,
} from "@catalog/shared";
import { semanticHash } from "@catalog/shared/hash";
import type { CopyWorkItem } from "./contract.ts";

/**
 * Which products the copywriter works on, and what it does to each.
 *
 * Two independent jobs, decided per product:
 *
 *  - WRITE COPY for a product that has none of ours (new from the sync), or
 *    whose machine-written copy no longer matches its facts (the source changed
 *    the description or the pack). Never for copy a person wrote: `hand` (the
 *    curated file) and `edited` (an AI text the owner corrected) are final, and
 *    so is any override whose origin is unknown.
 *  - RESEARCH a product whose recorded facts are suspicious: the source's name
 *    and pack field disagree about the size, there is no size at all, or the
 *    price per cup is wildly unlike its format's. These are the cases that went
 *    wrong before (an 18-pod tin listed as 100 pods made a €0.51 cup look like
 *    €0.09), and the research checks them against independent sources.
 *
 * The decision is a pure function of the rows (`selectCopyWork`), so it can be
 * tested without a database; `loadCopyCandidates` only reads.
 */

/** A pack size someone ruled out, as `facts_research.rejected` keeps it. */
export interface RejectedPack {
  readonly value: number;
  readonly unit: string;
}

/** What the copywriter needs from the last check of a product's facts. */
export interface StoredResearch {
  /** `researchBasis` of the supplier's statements when they were last checked. */
  readonly basis: string | null;
  /** Why a different size was found but not applied; null when nothing is pending. */
  readonly heldBack: string | null;
  readonly applied: boolean;
  /** Sizes the owner turned down: never applied again on the strength of research. */
  readonly rejected: readonly RejectedPack[];
}

/** A product as the copywriter reads it. */
export interface CopyCandidate {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly name: string;
  readonly sourceKey: string;
  readonly brandName: string | null;
  readonly brandSourceKey: string | null;
  readonly categoryKeys: readonly string[];
  readonly descriptionText: string | null;
  readonly summary: string | null;
  /** Our published body, as plain paragraphs (empty when there is none). */
  readonly bodyParagraphs: readonly string[];
  readonly weightValue: string | null;
  readonly weightUnit: string | null;
  readonly price: string | null;
  readonly arabicaPercent: number | null;
  readonly origin: string | null;
  readonly roast: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly characteristics: readonly { label: string; value: string }[];
  readonly sourceData: Readonly<Record<string, unknown>>;
  readonly copyOrigin: string | null;
  readonly copySourceHash: string | null;
  readonly copyAttempts: number;
  readonly packOverrideValue: string | null;
  readonly research: StoredResearch | null;
  readonly lastChangedAt: Date;
}

/** Consecutive failures after which a product is left for the owner. */
export const MAX_COPY_ATTEMPTS = 3;

/**
 * A price per cup this many times its format's median (or that fraction of
 * it) is not a bargain or a luxury; in this catalogue it has always been a
 * misread pack size.
 */
export const PRICE_OUTLIER_FACTOR = 3;

/**
 * The fingerprint of what copy is written FROM.
 *
 * Not `semantic_hash`, which also moves with the price and the images: a price
 * change is not a reason to rewrite a description. Only what the text could
 * state is in here - including the pack in force, so copy is rewritten after a
 * size is corrected.
 */
export function copySourceHash(candidate: CopyCandidate): string {
  return semanticHash({
    name: candidate.name,
    description: candidate.descriptionText ?? null,
    // The column reads back as "18.0000"; a corrected size is written as "18".
    weightValue: candidate.weightValue === null ? null : stripTrailingZeros(candidate.weightValue),
    weightUnit: candidate.weightUnit,
    arabicaPercent: candidate.arabicaPercent,
    origin: candidate.origin,
    roast: candidate.roast,
    attributes: candidate.attributes,
    characteristics: candidate.characteristics,
  });
}

/**
 * The fingerprint of what the SUPPLIER says about the pack: its name, its pack
 * field, and the size the sync decided from them.
 *
 * Research is redone only when this changes. It deliberately leaves out the
 * stored size (which research itself may have changed - including it would
 * make every correction a reason to research again) and the price (a price
 * change is no reason to look for the pack again). And it is what notices a
 * supplier repackaging a product whose size we corrected.
 */
export function researchBasis(candidate: CopyCandidate): string {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return semanticHash({
    name: candidate.name,
    packField: text(candidate.sourceData.packField),
    weightCanonical: text(candidate.sourceData.weightCanonical),
  });
}

export interface CopyWorkPlan {
  readonly items: readonly CopyWorkItem[];
  /** How many products wanted work but were cut by `limit`. */
  readonly deferred: number;
  /** Products skipped after `MAX_COPY_ATTEMPTS` failures. */
  readonly givenUp: readonly string[];
}

export interface SelectOptions {
  /** At most this many products in this run. */
  readonly limit: number;
  /** Work on these slugs only, whatever their state (manual runs). */
  readonly slugs?: readonly string[];
  /** Rewrite AI copy even when it is current (with `slugs`). */
  readonly force?: boolean;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function naming(candidate: CopyCandidate) {
  return productName({
    sourceName: candidate.name,
    sourceKey: candidate.sourceKey,
    brand:
      candidate.brandName || candidate.brandSourceKey
        ? { name: candidate.brandName, sourceKey: candidate.brandSourceKey }
        : null,
    categoryKeys: candidate.categoryKeys,
    packValue: candidate.weightValue,
    packUnit: candidate.weightUnit,
    packAuthoritative: candidate.packOverrideValue !== null,
  });
}

/** Price per cup, as a number, or null when it cannot be computed. */
function cupPrice(candidate: CopyCandidate): number | null {
  const servings = packServings(
    candidate.weightValue,
    candidate.weightUnit,
    productKind(candidate.name),
  );
  const perCup = pricePerServing(candidate.price, servings);
  const value = perCup === null ? Number.NaN : Number(perCup);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Copy a person wrote, or copy nobody can vouch for: the machine leaves it
 * alone. An override without an origin predates the copywriter.
 */
function humanCopy(candidate: CopyCandidate): boolean {
  if (candidate.copyOrigin === "hand" || candidate.copyOrigin === "edited") return true;
  return (
    candidate.copyOrigin === null &&
    (candidate.summary !== null || candidate.bodyParagraphs.length > 0)
  );
}

/** Whether an earlier check left a different size unsettled. */
export function packDisputed(candidate: CopyCandidate): boolean {
  return (
    candidate.research !== null &&
    !candidate.research.applied &&
    candidate.research.heldBack !== null
  );
}

/** Why a product's recorded facts deserve a second look, if they do. */
export function researchReasons(
  candidate: CopyCandidate,
  formatMedians: ReadonlyMap<string, number>,
): string[] {
  // Checked since the supplier last said anything new about the pack.
  const basis = researchBasis(candidate);
  if (candidate.research?.basis === basis) return [];

  const reasons: string[] = [];
  const conflict = parsePackSizeConflict(candidate.sourceData.packSizeConflict);
  if (conflict) {
    reasons.push(
      `името при доставчика казва ${conflict.inName}, а полето за опаковка — ${conflict.inPackField}`,
    );
  }
  if (!candidate.weightValue || !candidate.weightUnit) {
    reasons.push("няма записан размер на опаковката");
  }
  if (candidate.packOverrideValue !== null && candidate.research?.basis) {
    reasons.push("доставчикът промени данните за опаковката, откакто размерът ни беше поправен");
  }
  const format = naming(candidate).format?.id ?? null;
  const perCup = cupPrice(candidate);
  const typical = format ? formatMedians.get(format) : undefined;
  if (perCup !== null && typical !== undefined && typical > 0) {
    const ratio = perCup / typical;
    if (ratio > PRICE_OUTLIER_FACTOR || ratio < 1 / PRICE_OUTLIER_FACTOR) {
      reasons.push(
        `цената на чаша (€${perCup.toFixed(3)}) е ${ratio > 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)} пъти ${ratio > 1 ? "над" : "под"} обичайните €${typical.toFixed(3)} за формата — обикновено знак за грешно разчетен размер`,
      );
    }
  }
  return reasons;
}

function toWorkItem(
  candidate: CopyCandidate,
  task: CopyWorkItem["task"],
  siblings: readonly string[],
): CopyWorkItem {
  const name = naming(candidate);
  const conflict = parsePackSizeConflict(candidate.sourceData.packSizeConflict);
  return {
    id: candidate.id,
    slug: candidate.slug,
    title: name.title,
    brand: name.brand,
    format: name.format?.label ?? null,
    kind: productKind(candidate.name),
    pack: {
      // The stored size: the one the price per cup is computed from, so the
      // one research must confirm or correct. The name's figure is `inName`.
      label:
        packQuantityLabel(candidate.weightValue, candidate.weightUnit) ??
        name.quantity?.label ??
        null,
      inName: conflict?.inName ?? null,
      inPackField: conflict?.inPackField ?? null,
      mayState: !packDisputed(candidate),
    },
    priceEur: candidate.price,
    facts: {
      arabicaPercent: candidate.arabicaPercent,
      origin: candidate.origin,
      roast: candidate.roast,
      attributes: candidate.attributes,
      characteristics: candidate.characteristics,
    },
    // Long descriptions are cut: the facts are in the first part, and a
    // runaway source page should not fill the batch.
    sourceDescription: candidate.descriptionText?.trim().slice(0, 3000) || null,
    siblingSummaries: siblings,
    task,
  };
}

/**
 * Decide this run's work. Pure: rows in, plan out.
 *
 * Order matters when `limit` cuts the list: research first (a wrong pack size
 * is a wrong price per cup on the page today), then products with no copy of
 * ours at all, then stale AI copy. Within each, newest first.
 */
export function selectCopyWork(
  candidates: readonly CopyCandidate[],
  options: SelectOptions,
): CopyWorkPlan {
  const active = candidates.filter((c) => c.status === "active");

  const byFormat = new Map<string, number[]>();
  for (const candidate of active) {
    const format = naming(candidate).format?.id;
    const perCup = cupPrice(candidate);
    if (!format || perCup === null) continue;
    byFormat.set(format, [...(byFormat.get(format) ?? []), perCup]);
  }
  const formatMedians = new Map<string, number>();
  for (const [format, values] of byFormat) {
    // A median of a handful of products is noise, not a norm.
    if (values.length >= 5) formatMedians.set(format, median(values) as number);
  }

  const wanted = options.slugs ? new Set(options.slugs) : null;
  const givenUp: string[] = [];
  const queued: { candidate: CopyCandidate; task: CopyWorkItem["task"]; rank: number }[] = [];

  for (const candidate of active) {
    if (wanted && !wanted.has(candidate.slug)) continue;

    const ours = !humanCopy(candidate);
    const missingCopy = ours && candidate.copyOrigin === null;
    const staleCopy =
      candidate.copyOrigin === "ai" &&
      (candidate.copySourceHash !== copySourceHash(candidate) ||
        (wanted !== null && options.force === true));
    const writeCopy = missingCopy || staleCopy;
    const reasons = researchReasons(candidate, formatMedians);
    const research = reasons.length > 0;

    if (!writeCopy && !research) continue;
    if (!wanted && candidate.copyAttempts >= MAX_COPY_ATTEMPTS) {
      givenUp.push(candidate.slug);
      continue;
    }
    queued.push({
      candidate,
      task: { writeCopy, research, researchReasons: reasons },
      rank: research ? 0 : missingCopy ? 1 : 2,
    });
  }

  queued.sort(
    (a, b) =>
      a.rank - b.rank || b.candidate.lastChangedAt.getTime() - a.candidate.lastChangedAt.getTime(),
  );
  const chosen = queued.slice(0, options.limit);

  // Siblings: our published summaries for the same brand, so the model can
  // see what it must not repeat. A brand's line in another size is the case
  // that matters; the brand as a whole is a cheap superset of it.
  const summariesByBrand = new Map<string, string[]>();
  for (const candidate of active) {
    if (!candidate.summary || !candidate.brandSourceKey) continue;
    summariesByBrand.set(candidate.brandSourceKey, [
      ...(summariesByBrand.get(candidate.brandSourceKey) ?? []),
      candidate.summary,
    ]);
  }

  const items = chosen.map(({ candidate, task }) => {
    const siblings = (summariesByBrand.get(candidate.brandSourceKey ?? "") ?? [])
      .filter((summary) => summary !== candidate.summary)
      .slice(0, 12);
    return toWorkItem(candidate, task, siblings);
  });

  return { items, deferred: queued.length - chosen.length, givenUp };
}

/** `<p>` paragraphs, as the copywriter and `copy:apply` write them, back to text. */
export function htmlParagraphs(html: string | null): string[] {
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

/** Read `facts_research` defensively: it is JSON written by an earlier version. */
export function readStoredResearch(raw: unknown): StoredResearch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const rejected = Array.isArray(record.rejected)
    ? record.rejected.flatMap((entry): RejectedPack[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const { value, unit } = entry as Record<string, unknown>;
        return typeof value === "number" && typeof unit === "string" ? [{ value, unit }] : [];
      })
    : [];
  return {
    // Version 1 records hashed something else; they simply count as unchecked.
    basis: record.version === 2 && typeof record.basis === "string" ? record.basis : null,
    heldBack: typeof record.heldBack === "string" ? record.heldBack : null,
    applied: record.applied === true,
    rejected,
  };
}

/** Read every product the copywriter could work on. One query, no writes. */
export async function loadCopyCandidates(db: Database): Promise<CopyCandidate[]> {
  const result = await db.execute(sql`
    select
      p.id, p.slug, p.status, p.name, p.source_key,
      b.name as brand_name, b.source_key as brand_source_key,
      array(
        select c.source_key from product_categories pc
        join categories c on c.id = pc.category_id
        where pc.product_id = p.id
      ) as category_keys,
      p.description_text, p.description_text_override as summary,
      p.description_html_override as body_html,
      p.weight_value::text as weight_value, p.weight_unit,
      coalesce(p.retail_price_override, p.current_price)::text as price,
      p.arabica_percent, p.origin, p.roast, p.attributes, p.characteristics, p.source_data,
      p.copy_origin, p.copy_source_hash, p.copy_attempts,
      p.pack_override_value::text as pack_override_value,
      p.facts_research, p.last_changed_at
    from products p
    left join brands b on b.id = p.brand_id
    where p.status = 'active'
  `);
  // postgres-js returns the rows themselves, as everywhere else `execute` is used.
  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    status: String(row.status),
    name: String(row.name),
    sourceKey: String(row.source_key),
    brandName: (row.brand_name as string | null) ?? null,
    brandSourceKey: (row.brand_source_key as string | null) ?? null,
    categoryKeys: (row.category_keys as string[] | null) ?? [],
    descriptionText: (row.description_text as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    bodyParagraphs: htmlParagraphs((row.body_html as string | null) ?? null),
    weightValue: (row.weight_value as string | null) ?? null,
    weightUnit: (row.weight_unit as string | null) ?? null,
    price: (row.price as string | null) ?? null,
    arabicaPercent: (row.arabica_percent as number | null) ?? null,
    origin: (row.origin as string | null) ?? null,
    roast: (row.roast as string | null) ?? null,
    attributes: (row.attributes as Record<string, string> | null) ?? {},
    characteristics: (row.characteristics as { label: string; value: string }[] | null) ?? [],
    sourceData: (row.source_data as Record<string, unknown> | null) ?? {},
    copyOrigin: (row.copy_origin as string | null) ?? null,
    copySourceHash: (row.copy_source_hash as string | null) ?? null,
    copyAttempts: Number(row.copy_attempts ?? 0),
    packOverrideValue: (row.pack_override_value as string | null) ?? null,
    research: readStoredResearch(row.facts_research),
    lastChangedAt: new Date(row.last_changed_at as string),
  }));
}
