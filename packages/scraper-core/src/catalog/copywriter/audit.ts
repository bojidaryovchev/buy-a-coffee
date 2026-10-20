import {
  MAX_INTERNAL_RUN_WORDS,
  MAX_SOURCE_OVERLAP,
  MAX_SOURCE_RUN_WORDS,
  longestSharedRun,
  normalizeForComparison,
  overlapRatio,
  parseWeight,
  shingles,
} from "@catalog/shared";
import { compatibilityProblems } from "@catalog/shared/compatibility-copy";
import type { CopyWorkItem, GeneratedCopy } from "./contract.ts";

/**
 * The gate machine-written copy passes before it may reach the database.
 *
 * The model is told the rules; this checks them, because a page that publishes
 * the source's paragraph in different order is the exact problem the copy
 * exists to solve, and "the prompt said not to" is not a guarantee. A text
 * that fails is not published: the product keeps what it had (its generated
 * sentence, or its previous copy) and the failure is recorded against it.
 *
 * The originality measures are the same functions and limits the CI audit of
 * the hand-written file uses (`@catalog/shared/copy-originality`), and the
 * compatibility rules the same ones its test holds the hand-written file to
 * (`@catalog/shared/compatibility-copy`).
 */

export interface CopyAuditContext {
  /**
   * Every published summary, normalised (`normalizeForComparison`), to the id
   * of the product wearing it - so a product's own old text is not a duplicate
   * of its new one.
   */
  readonly summaries: ReadonlyMap<string, string>;
  /** Every published body, by product id, as plain paragraphs. */
  readonly bodies: ReadonlyMap<string, readonly string[]>;
}

/** What the copy may say about the pack. */
export interface PackRule {
  /** The size in force, as a label ("1 кг"), or null when unknown. */
  readonly label: string | null;
  /** False while the size is disputed: then the copy states no size at all. */
  readonly mayState: boolean;
}

export interface CopyAuditResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/** How a unit reads in the problems the owner sees. */
const UNIT_LABEL: Record<string, string> = { g: "г", ml: "мл", pc: "бр." };

const SUMMARY_MIN = 40;
/** A search result shows about this much; the hand-written copy stays under it. */
const SUMMARY_MAX = 200;
const PARAGRAPH_MIN = 25;
const PARAGRAPH_MAX = 700;

/**
 * Below this many five-word phrases a source is mostly the product's name and
 * size, and any honest text naming the product "overlaps" it.
 */
const MIN_SOURCE_PHRASES = 12;

/**
 * The source shop's name and domain must never appear in our copy. Matched as
 * a name - one word, Latin, or capitalised - because "кафе зона" in lower case
 * is an ordinary phrase ("a coffee corner") that office copy may well use.
 */
const FORBIDDEN = [/kafe\s*zona/i, /kafezona/i, /кафезона/i, /Кафе\s?Зона/, /КАФЕ\s?ЗОНА/];

/**
 * Prices and currencies go stale the day they change; copy does not mention
 * them. Bounded by lookarounds, not `\b`: `\b` knows only ASCII letters, so
 * `\bлв\b` would never match in Bulgarian text.
 */
const PRICE_TALK = /(€|(?<![\p{L}\p{N}])(?:евро|лв|лева|стотинки|eur|bgn)(?![\p{L}\p{N}]))/iu;

const URL_LIKE = /(https?:\/\/|www\.|\.(?:com|bg|net|eu)\b)/i;

/** Share of letters that are Cyrillic. Brand and line names are Latin, so not 1. */
function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const cyrillic = letters.filter((letter) => /\p{Script=Cyrillic}/u.test(letter)).length;
  return cyrillic / letters.length;
}

/** Unit words as copy writes them, to the unit `parseWeight` reads. */
const UNIT_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:кг|килограм(?:а|и)?)$/u, "кг"],
  [/^(?:гр|г|грам(?:а|и)?)$/u, "г"],
  [/^(?:мл|милилит(?:ър|ра|ри))$/u, "мл"],
  [/^(?:л|лит(?:ър|ра|ри))$/u, "л"],
  [/^(?:бр|броя|брой|капсул[аи]?|доз[аи]|дози|пакетчета?|стика|стик|стикове|филтъра?)$/u, "бр"],
];

/**
 * Pack sizes the text states: "500 г", "1 кг", "1 000 г", "500 грама",
 * "16 капсули", "10 броя". Returned as normalised weights so "1 кг" and
 * "1000 г" compare equal.
 */
export function statedPackSizes(text: string): { value: string; unit: string }[] {
  const found: { value: string; unit: string }[] = [];
  const pattern =
    /(?<![\p{L}\p{N}.,])(\d{1,3}(?:[ \u00a0]\d{3})+|\d+(?:[.,]\d+)?)\s*(килограм(?:а|и)?|кг|грам(?:а|и)?|гр|г|милилит(?:ър|ра|ри)|мл|лит(?:ър|ра|ри)|л|броя|брой|бр|капсул[аи]?|дози|доз[аи]|филтърни\s+дози|пакетчета?|стикове|стика|стик|филтъра?)(?![\p{L}])/giu;
  for (const match of text.matchAll(pattern)) {
    const number = (match[1] as string).replace(/[ \u00a0]/g, "");
    const word = (match[2] as string).toLowerCase().replace(/^филтърни\s+/, "");
    const unit = UNIT_WORDS.find(([test]) => test.test(word))?.[1];
    if (!unit) continue;
    const weight = parseWeight(`${number} ${unit}`);
    if (weight) found.push({ value: weight.value, unit: weight.unit });
  }
  return found;
}

/**
 * Only quantities a pack could be. Copy names doses too - "7 г на чаша",
 * "2 капсули за лате" - and those are facts about a cup, not the pack. The
 * smallest pack in this catalogue is 125 g / 10 pieces.
 */
function plausiblePack(stated: { value: string; unit: string }): boolean {
  const value = Number(stated.value);
  return (
    ((stated.unit === "g" || stated.unit === "ml") && value >= 100) ||
    (stated.unit === "pc" && value >= 5)
  );
}

/**
 * Replace the product's own names with a token the other text cannot share, so
 * naming the product - which the source and our copy both must do - is not
 * counted as copied phrasing.
 */
function withoutNames(text: string, names: readonly string[], token: string): string {
  let result = text;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "giu"), ` ${token} `);
  }
  return result;
}

/**
 * Check one generated text for one product.
 *
 * `pack` is what the copy may say about the size - the corrected one if the
 * research corrected it, nothing at all while it is disputed. A text that
 * names another size is the failure the hand-written copy suffered from
 * (prose saying "500 г" over a 1 kg pack), so it is caught here rather than
 * published.
 */
export function auditGeneratedCopy(
  item: CopyWorkItem,
  copy: GeneratedCopy,
  pack: PackRule,
  context: CopyAuditContext,
): CopyAuditResult {
  const problems: string[] = [];
  const summary = copy.summary.trim();
  const body = copy.body.map((paragraph) => paragraph.trim()).filter(Boolean);
  const all = [summary, ...body].join(" ");

  if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
    problems.push(
      `краткото описание е ${summary.length} знака (позволени ${SUMMARY_MIN}–${SUMMARY_MAX})`,
    );
  }
  if (/\n/.test(summary)) problems.push("краткото описание е на няколко реда");
  if (body.length < 2 || body.length > 4) {
    problems.push(`описанието има ${body.length} абзаца (позволени 2–4)`);
  }
  for (const [index, paragraph] of body.entries()) {
    if (paragraph.length < PARAGRAPH_MIN || paragraph.length > PARAGRAPH_MAX) {
      problems.push(
        `абзац ${index + 1} е ${paragraph.length} знака (позволени ${PARAGRAPH_MIN}–${PARAGRAPH_MAX})`,
      );
    }
  }

  if (cyrillicShare(all) < 0.6) problems.push("текстът не е предимно на български");
  if (FORBIDDEN.some((pattern) => pattern.test(all))) {
    problems.push("текстът назовава магазина източник");
  }
  if (URL_LIKE.test(all)) problems.push("текстът съдържа уеб адрес");
  if (PRICE_TALK.test(all)) problems.push("текстът споменава цена или валута");
  if (/<[^>]+>/.test(all)) problems.push("текстът съдържа HTML");

  /*
   * A compatibility promise the machine's maker contradicts — „машини Dolce
   * Gusto“, which includes NEO; „домашни машини Nespresso“, which includes
   * Vertuo; Caffitaly in a K-fee; a Cafissimo without Tchibo's word — is the
   * error the hand-written copy was corrected for, and a supplier's attribute
   * („Съвместимост: Dolce Gusto“) invites it. One problem per rule: the owner
   * needs the fix, not every sentence it applies to.
   */
  const compatibility = new Map<string, string>();
  for (const problem of compatibilityProblems([summary, ...body])) {
    if (!compatibility.has(problem.rule)) compatibility.set(problem.rule, problem.reason);
  }
  for (const reason of compatibility.values()) problems.push(`съвместимост: ${reason}`);

  const source = item.sourceDescription?.trim() ?? "";
  if (source) {
    const names = [item.title, item.brand ?? ""];
    const theirs = withoutNames(source, names, "qqsource");
    const ours = withoutNames(all, names, "qqours");
    if (shingles(theirs).size >= MIN_SOURCE_PHRASES) {
      const ratio = overlapRatio(theirs, ours);
      if (ratio > MAX_SOURCE_OVERLAP) {
        problems.push(
          `${Math.round(ratio * 100)} % от изразите на източника са запазени (граница ${Math.round(
            MAX_SOURCE_OVERLAP * 100,
          )} %)`,
        );
      }
    }
    const run = longestSharedRun(theirs, ours);
    if (run >= MAX_SOURCE_RUN_WORDS) {
      problems.push(`повтаря ${run} поредни думи от източника`);
    }
    if (normalizeForComparison(summary) === normalizeForComparison(source)) {
      problems.push("краткото описание е дословно описанието на източника");
    }
  }

  const wearer = context.summaries.get(normalizeForComparison(summary));
  if (wearer !== undefined && wearer !== item.id) {
    problems.push("краткото описание е същото като на друг продукт");
  }
  for (const sibling of item.siblingSummaries) {
    const run = longestSharedRun(sibling, summary);
    if (run > MAX_INTERNAL_RUN_WORDS / 2) {
      problems.push(`краткото описание повтаря ${run} поредни думи от това на сроден продукт`);
      break;
    }
  }
  // Our own paragraphs on two of our URLs are the duplicate problem moved in-house.
  paragraphs: for (const [index, paragraph] of body.entries()) {
    for (const [owner, published] of context.bodies) {
      if (owner === item.id) continue;
      for (const other of published) {
        const run = longestSharedRun(other, paragraph);
        if (run > MAX_INTERNAL_RUN_WORDS) {
          problems.push(
            `абзац ${index + 1} повтаря ${run} поредни думи от описанието на друг продукт`,
          );
          break paragraphs;
        }
      }
    }
  }

  const stated = statedPackSizes(all).filter(plausiblePack);
  if (!pack.mayState && stated.length > 0) {
    problems.push("посочва размер на опаковката, докато размерът е спорен");
  } else if (pack.label && stated.length > 0) {
    const allowed = parseWeight(pack.label);
    const matches = (size: { value: string; unit: string }) =>
      allowed !== null &&
      size.unit === allowed.unit &&
      Number(size.value) === Number(allowed.value);
    // A text that states the right size may also name parts of it ("8 капсули
    // кафе и 8 капсули мляко"); one that never states it states a wrong one.
    const wrong = stated.find(
      (size) => allowed !== null && size.unit === allowed.unit && !matches(size),
    );
    if (wrong && !stated.some(matches)) {
      problems.push(
        `посочва опаковка от ${wrong.value} ${UNIT_LABEL[wrong.unit] ?? wrong.unit}, а опаковката е ${pack.label}`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
