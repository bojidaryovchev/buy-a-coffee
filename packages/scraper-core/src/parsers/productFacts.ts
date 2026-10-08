/**
 * Facts a product page states about the coffee itself: how much of it is
 * arabica, where it comes from, how it is roasted.
 *
 * The rule is "stated, not inferred". A fact is returned only when the page
 * says it in one unambiguous way; everything else is `null`. That means:
 *
 *  - `100% робуста` does NOT yield `arabicaPercent: 0`. The page said nothing
 *    about arabica; subtracting from 100 would be inference.
 *  - `около 80% арабика` is hedged, so it yields null rather than 80.
 *  - Two different figures on one page are a contradiction, not a choice.
 *
 * Precedence follows the plan (B6): the labelled characteristics list first,
 * an unambiguous phrase in the page's own prose second. A labelled entry that
 * exists but cannot be used (hedged, contradictory) does not fall through to
 * prose, because prose would only restate the same hedge.
 */

export interface ProductCharacteristic {
  /** Label as rendered, without its trailing colon, e.g. `Състав`. */
  readonly label: string;
  readonly value: string;
}

export interface ProductFacts {
  /** 0..100, exactly as stated. */
  readonly arabicaPercent: number | null;
  /** Text as stated by the page, e.g. `Уганда и Индия`. */
  readonly origin: string | null;
  /** Normalised level phrase, e.g. `средно тъмно`, or the labelled text. */
  readonly roast: string | null;
}

type Finding<T> =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "value"; readonly value: T };

const NONE = { kind: "none" } as const;
const AMBIGUOUS = { kind: "ambiguous" } as const;

/** Latin letters that are visually identical to Cyrillic ones. */
const LOOKALIKES: Readonly<Record<string, string>> = {
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
  k: "к",
  m: "м",
  t: "т",
  h: "н",
  b: "в",
};

/**
 * The source's own copy contains words typed with Latin letters inside a
 * Cyrillic word (`арaбика` with a Latin "a" was observed). Fix those words,
 * and only those: Latin words such as brand names are left alone.
 */
function repairMixedScript(text: string): string {
  return text.replace(/[\p{L}]+/gu, (word) => {
    if (!/\p{Script=Cyrillic}/u.test(word) || !/[A-Za-z]/.test(word)) return word;
    return word.replace(/[A-Za-z]/g, (ch) => {
      const mapped = LOOKALIKES[ch.toLowerCase()];
      if (!mapped) return ch;
      return ch === ch.toLowerCase() ? mapped : mapped.toUpperCase();
    });
  });
}

function prepare(text: string): string {
  return repairMixedScript(text).replace(/\s+/gu, " ").trim();
}

function labelKey(label: string): string {
  return label
    .replace(/[:：]\s*$/u, "")
    .trim()
    .toLowerCase();
}

function valuesForLabel(
  characteristics: readonly ProductCharacteristic[],
  accepted: RegExp,
): string[] {
  const values: string[] = [];
  for (const entry of characteristics) {
    if (!accepted.test(labelKey(entry.label))) continue;
    const value = prepare(entry.value);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

// ---------------------------------------------------------------------------
// arabica share
// ---------------------------------------------------------------------------

/**
 * Words that turn a figure into an estimate or a bound, matched against the
 * text just before the number. A bare "от" is deliberately absent: "бленд от
 * 40% арабика" means "a blend of", not "from".
 */
const HEDGE_BEFORE =
  /(?:^|[^\p{L}])(?:около|приблизително|приблизит|прибл|над|под|поне|почти|минимум|максимум|до|между)\.?\s*$|[~≈<>]\s*$|\d\s*[-–—]\s*$/iu;

const ARABICA_SHARE = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:[\p{L}-]+\s+)?арабика/giu;

export function findArabicaShare(rawText: string): Finding<number> {
  const text = prepare(rawText);
  const seen = new Set<number>();
  let hedged = false;

  for (const match of text.matchAll(ARABICA_SHARE)) {
    const value = Number.parseFloat((match[1] ?? "").replace(",", "."));
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (HEDGE_BEFORE.test(before)) {
      hedged = true;
      continue;
    }
    if (!Number.isFinite(value) || value < 0 || value > 100) return AMBIGUOUS;
    seen.add(value);
  }

  if (hedged) return AMBIGUOUS;
  if (seen.size === 0) return NONE;
  if (seen.size > 1) return AMBIGUOUS;
  return { kind: "value", value: [...seen][0] as number };
}

// ---------------------------------------------------------------------------
// roast
// ---------------------------------------------------------------------------

const ROAST_LEVEL = String.raw`(средно[\s-]+тъмн(?:о|ото)|светл(?:о|ото)|лек(?:о|ото)|средн(?:о|ото)|тъмн(?:о|ото))`;
const ROAST_BEFORE_NOUN = new RegExp(String.raw`${ROAST_LEVEL}\s+изпичане`, "giu");
const ROAST_AFTER_PARTICIPLE = new RegExp(
  String.raw`изпечен(?:а|о|и)?\s+${ROAST_LEVEL}(?![\p{L}])`,
  "giu",
);

/** A comparative or a softener makes the level relative, not stated. */
const ROAST_QUALIFIED_BEFORE = /(?:по-[\p{L}]*|по-|леко|малко|донякъде|почти|около)\s*$/iu;

function normaliseRoastLevel(level: string): string {
  const value = level.toLowerCase().replace(/[\s-]+/gu, " ");
  if (value.startsWith("средно тъмн")) return "средно тъмно";
  if (value.startsWith("светл")) return "светло";
  if (value.startsWith("лек")) return "леко";
  if (value.startsWith("средн")) return "средно";
  return "тъмно";
}

export function findRoastPhrase(rawText: string): Finding<string> {
  const text = prepare(rawText);
  const seen = new Set<string>();
  let qualified = false;

  for (const pattern of [ROAST_BEFORE_NOUN, ROAST_AFTER_PARTICIPLE]) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
      if (ROAST_QUALIFIED_BEFORE.test(before)) {
        qualified = true;
        continue;
      }
      seen.add(normaliseRoastLevel(match[1] ?? ""));
    }
  }

  if (qualified) return AMBIGUOUS;
  if (seen.size === 0) return NONE;
  if (seen.size > 1) return AMBIGUOUS;
  return { kind: "value", value: [...seen][0] as string };
}

// ---------------------------------------------------------------------------
// origin
// ---------------------------------------------------------------------------

/** "… с произход от Южна Америка и Индия." up to the end of the sentence. */
const ORIGIN_PHRASE = /произход\s+от\s+([^.!?;\n]+)/giu;

export function findOriginPhrase(rawText: string): Finding<string> {
  const text = prepare(rawText);
  const seen = new Set<string>();

  for (const match of text.matchAll(ORIGIN_PHRASE)) {
    const captured = (match[1] ?? "").trim();
    // A comma may end the origin ("…Уганда и Индия, изпечена…") or continue a
    // list ("…Индия, Уганда и Колумбия"). Nothing here can tell which, so a
    // comma makes the phrase ambiguous.
    if (!captured || captured.includes(",") || captured.length > 80) return AMBIGUOUS;
    seen.add(captured);
  }
  if (seen.size === 0) return NONE;
  if (seen.size > 1) return AMBIGUOUS;
  return { kind: "value", value: [...seen][0] as string };
}

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

const COMPOSITION_LABEL = /^състав$/u;
const ORIGIN_LABEL = /^произход$/u;
const ROAST_LABEL = /^(?:степен на )?(?:изпичане|печене|изпеченост)$/u;

function fromLabelled<T>(
  values: readonly string[],
  read: (text: string) => Finding<T>,
): Finding<T> {
  if (values.length === 0) return NONE;
  if (values.length > 1) return AMBIGUOUS;
  return read(values[0] as string);
}

function resolve<T>(labelled: Finding<T>, prose: () => Finding<T>): T | null {
  if (labelled.kind === "value") return labelled.value;
  if (labelled.kind === "ambiguous") return null;
  const fallback = prose();
  return fallback.kind === "value" ? fallback.value : null;
}

/**
 * Derive the stated facts from a page's characteristics and prose.
 *
 * `prose` is every paragraph the page prints about the product, and nothing
 * about other products: callers must not pass related-product cards.
 */
export function deriveProductFacts(input: {
  readonly characteristics: readonly ProductCharacteristic[];
  readonly prose: readonly string[];
}): ProductFacts {
  const { characteristics } = input;
  const proseText = input.prose.join("\n");

  const arabicaPercent = resolve(
    fromLabelled(valuesForLabel(characteristics, COMPOSITION_LABEL), findArabicaShare),
    () => findArabicaShare(proseText),
  );

  const origin = resolve(
    fromLabelled(valuesForLabel(characteristics, ORIGIN_LABEL), (text) => ({
      kind: "value",
      value: text,
    })),
    () => findOriginPhrase(proseText),
  );

  const roast = resolve(
    fromLabelled(valuesForLabel(characteristics, ROAST_LABEL), (text) => ({
      kind: "value",
      value: text.toLowerCase(),
    })),
    () => findRoastPhrase(proseText),
  );

  return { arabicaPercent, origin, roast };
}
