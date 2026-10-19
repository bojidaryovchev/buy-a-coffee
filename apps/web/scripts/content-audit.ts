/**
 * Originality audit for the hand-written content that is not product copy.
 *
 * `copy-audit.ts` holds our product copy against the source's product
 * descriptions. This holds the rest of what we wrote against the same text:
 *
 *   - the category introductions (`content/category-copy.ts`),
 *   - the Vending and Consumables pages (`content/vending.ts`),
 *   - the journal articles (`content/journal/`).
 *
 * Two questions, both about duplicate content across domains and within ours:
 *
 *   1. Does a piece share a long run of words with anything the source
 *      published that the snapshot holds?
 *   2. Do two of our own pieces repeat each other?
 *
 * The machinery is `copy-audit.ts`'s — five-word shingles and the 35 % ceiling
 * — plus one measure it does not need for product rewrites, explained below.
 * Pure functions over text: no database, no network, runnable in CI.
 */
import { categoryCopy } from "../content/category-copy.ts";
import { ARTICLES } from "../content/journal/index.ts";
import {
  landingCopy,
  machineBrandCopy,
  machineBrandFeatures,
  relatedCopy,
  type LandingFacts,
} from "../content/landing-copy.ts";
import { productCopy } from "../content/product-copy.ts";
import { consumablesCopy, vendingCopy } from "../content/vending.ts";
import { EMPTY_JOURNAL_FIGURES } from "../src/lib/catalog/journal-figures.ts";
import { LANDING_IDS } from "../src/lib/catalog/landings.ts";
import { plainText } from "../src/lib/journal.ts";
import { BREWING_SYSTEMS } from "../src/lib/recommend/systems.ts";
import {
  MAX_INTERNAL_RUN_WORDS,
  MAX_SOURCE_OVERLAP,
  MAX_SOURCE_RUN_WORDS,
  longestSharedRun,
  overlapRatio,
  sharedShare,
} from "@catalog/shared";
import type { ReferencePage, ReferenceProduct } from "./copy-audit.ts";

/*
 * `MAX_SOURCE_RUN_WORDS` (8) and `MAX_INTERNAL_RUN_WORDS` (15), with the run
 * and share measures, live in `@catalog/shared` beside the overlap ratio, so the
 * catalog copywriter applies the same limits to machine-written copy. Why
 * eight: a lifted sentence is a small share of a long source description yet
 * exactly the duplicate this exists to catch, and the longest honest run on
 * the current content is four words. Why fifteen between our own pieces: they
 * legitimately repeat a stock explanation in their own words; a pasted
 * sentence is what duplicates content, and the longest honest run is eleven.
 */
export { MAX_INTERNAL_RUN_WORDS, MAX_SOURCE_RUN_WORDS, longestSharedRun, sharedShare };

/** A piece of our own writing: what to call it and every word of it. */
export interface OwnPiece {
  /** Stable name, e.g. `category:nespresso` or `journal:cup-cost`. */
  readonly id: string;
  /** Which kind of content, for the report. */
  readonly kind: "category" | "business" | "landing" | "journal" | "product";
  readonly text: string;
}

/** A text the source published, as far as the snapshot holds it. */
export interface SourceText {
  readonly id: string;
  readonly text: string;
}

export interface ContentFinding {
  readonly piece: string;
  readonly against: string;
  readonly detail: string;
}

export interface ContentAudit {
  readonly pieces: number;
  readonly sources: number;
  readonly findings: readonly ContentFinding[];
  /** Highest values seen, so the report can show the margin and not only a pass. */
  readonly maxSourceRun: number;
  readonly maxSourceOverlap: number;
  readonly maxInternalRun: number;
  readonly maxInternalOverlap: number;
}

/** Every string in a value, depth first. Copy objects are plain data. */
export function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

export function auditOwnContent(
  pieces: readonly OwnPiece[],
  sources: readonly SourceText[],
): ContentAudit {
  const findings: ContentFinding[] = [];
  let maxSourceRun = 0;
  let maxSourceOverlap = 0;
  let maxInternalRun = 0;
  let maxInternalOverlap = 0;

  // New writing against everything the source published. Product copy is
  // audited against the source by `auditProductCopy`, not here.
  for (const piece of pieces) {
    if (piece.kind === "product") continue;
    for (const source of sources) {
      const run = longestSharedRun(source.text, piece.text);
      const ratio = overlapRatio(source.text, piece.text);
      maxSourceRun = Math.max(maxSourceRun, run);
      maxSourceOverlap = Math.max(maxSourceOverlap, ratio);

      if (run >= MAX_SOURCE_RUN_WORDS) {
        findings.push({
          piece: piece.id,
          against: source.id,
          detail: `shares a run of ${run} consecutive words with the source (limit ${
            MAX_SOURCE_RUN_WORDS - 1
          })`,
        });
      } else if (ratio > MAX_SOURCE_OVERLAP) {
        findings.push({
          piece: piece.id,
          against: source.id,
          detail: `${Math.round(ratio * 100)}% of the source's phrasing survives (limit ${Math.round(
            MAX_SOURCE_OVERLAP * 100,
          )}%)`,
        });
      }
    }
  }

  // Our pieces against each other: every new piece against every other piece,
  // product copy included. Two product entries are compared by
  // `auditProductCopy`, which has its own rule for them.
  for (let i = 0; i < pieces.length; i += 1) {
    const a = pieces[i] as OwnPiece;
    for (let j = i + 1; j < pieces.length; j += 1) {
      const b = pieces[j] as OwnPiece;
      if (a.kind === "product" && b.kind === "product") continue;

      const run = longestSharedRun(a.text, b.text);
      const share = sharedShare(a.text, b.text);
      maxInternalRun = Math.max(maxInternalRun, run);
      maxInternalOverlap = Math.max(maxInternalOverlap, share);

      if (run > MAX_INTERNAL_RUN_WORDS) {
        findings.push({
          piece: a.id,
          against: b.id,
          detail: `repeats a run of ${run} consecutive words from our own ${b.kind} copy (limit ${MAX_INTERNAL_RUN_WORDS})`,
        });
      } else if (share > MAX_SOURCE_OVERLAP) {
        findings.push({
          piece: a.id,
          against: b.id,
          detail: `${Math.round(share * 100)}% of the shorter text is shared with ${b.id} (limit ${Math.round(
            MAX_SOURCE_OVERLAP * 100,
          )}%)`,
        });
      }
    }
  }

  return {
    pieces: pieces.length,
    sources: sources.length,
    findings,
    maxSourceRun,
    maxSourceOverlap,
    maxInternalRun,
    maxInternalOverlap,
  };
}

/* --- What there is to audit ---------------------------------------------- */

/**
 * What a landing's copy is rendered from when it is read for this audit: every
 * brewing system and no figure. The copy is functions of the catalog's facts;
 * with every system present each one takes its longest branch, and with no
 * price range the sentences that only quote a figure drop out, which leaves
 * the prose that is ours to compare.
 */
const LANDING_AUDIT_FACTS: LandingFacts = {
  count: 2,
  systems: BREWING_SYSTEMS,
  methods: ["capsule", "pod", "beans"],
  cupRange: null,
  commonPack: null,
  currency: "EUR",
};

/** The written content, one piece per category, business page, landing and article. */
export function ownContentPieces(): OwnPiece[] {
  const pieces: OwnPiece[] = [];

  for (const [key, copy] of Object.entries(categoryCopy)) {
    pieces.push({ id: `category:${key}`, kind: "category", text: collectStrings(copy).join("\n") });
  }

  pieces.push(
    { id: "business:vending", kind: "business", text: collectStrings(vendingCopy).join("\n") },
    {
      id: "business:consumables",
      kind: "business",
      text: collectStrings(consumablesCopy).join("\n"),
    },
  );

  for (const id of LANDING_IDS) {
    const copy = landingCopy[id];
    pieces.push({
      id: `landing:${id}`,
      kind: "landing",
      text: [
        copy.h1,
        copy.title(LANDING_AUDIT_FACTS),
        copy.description(LANDING_AUDIT_FACTS),
        ...copy.intro(LANDING_AUDIT_FACTS),
        copy.llms,
      ].join("\n"),
    });
  }
  pieces.push({
    id: "landing:machines",
    kind: "landing",
    text: [
      machineBrandCopy.title("Krups", true),
      machineBrandCopy.h1("Krups"),
      machineBrandCopy.description("Krups", true),
      ...Object.values(machineBrandFeatures).flatMap((feature) => [
        feature.title,
        feature.h1,
        feature.lead,
        feature.listHeading,
        feature.description(LANDING_AUDIT_FACTS),
      ]),
      ...collectStrings(relatedCopy),
    ].join("\n"),
  });

  for (const article of ARTICLES) {
    pieces.push({
      id: `journal:${article.slug}`,
      kind: "journal",
      // Read with every catalog figure missing: the body must work that way,
      // and it is the figure-free prose that is ours to compare.
      text: [
        article.title,
        article.description,
        plainText(article.body(EMPTY_JOURNAL_FIGURES)),
      ].join("\n"),
    });
  }

  return pieces;
}

/** Our product copy as pieces, so new writing can be compared with it too. */
export function productCopyPieces(): OwnPiece[] {
  return Object.entries(productCopy).map(([slug, entry]) => ({
    id: `product:${slug}`,
    kind: "product" as const,
    text: [entry.summary, ...entry.body].join("\n"),
  }));
}

/**
 * Every source text the snapshot holds that new content could be copying.
 *
 * Product descriptions, and the meta descriptions of the other pages the crawl
 * recorded. What it does NOT hold, and the report says so: any category
 * description (the category pages carry none in the snapshot), any brand
 * description, and any blog article (only the blog index was recorded).
 */
export function sourceTexts(
  products: readonly ReferenceProduct[],
  pages: readonly ReferencePage[],
): SourceText[] {
  const texts: SourceText[] = [];
  for (const product of products) {
    const text = product.descriptionText?.trim();
    if (text) texts.push({ id: `product:${product.slug ?? product.sourceKey}`, text });
  }
  for (const page of pages) {
    const text = page.metaDescription?.trim();
    // Product pages repeat the product description, which is already above.
    if (!text || page.isSoft404 || page.pageType === "product") continue;
    texts.push({ id: `page:${page.pageType ?? "other"}:${page.path ?? "?"}`, text });
  }
  return texts;
}
