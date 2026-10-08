import type { TasteAnswer } from "./answers";

/**
 * What the source states about the coffee itself — how much of it is arabica
 * and how it is roasted — as soft evidence for the taste answer.
 *
 * Pure, like the rest of the scorer. Three rules shape everything here:
 *
 *  1. **A fact only speaks for an answer it genuinely bears on.** Each taste
 *     option is a situation, so each is judged separately in `TASTE_LEANING`
 *     below. Where a fact says nothing defensible about the situation, the
 *     fact does not move the score at all.
 *  2. **Absence is neutral.** A missing fact contributes exactly 0. A stated
 *     fact contributes in both directions around a neutral midpoint — a
 *     supporting fact adds, a contradicting fact subtracts — so owning a fact
 *     is never an advantage in itself, and a product the source simply did not
 *     describe is not marked down for it.
 *  3. **Facts refine, they do not decide.** The weights are small enough that
 *     the largest possible swing from both facts together stays below one
 *     step of the strength answer, which the customer was actually asked about.
 *
 * The data layer stores a fact only when the page states it, so "no value"
 * covers "not mentioned", "hedged" and "contradictory" alike. A `100% робуста`
 * page is stored as no arabica figure, not as 0: nothing here may read an
 * absent figure as "robusta".
 */

/** Maximum effect of the arabica share on one product, in either direction. */
export const WEIGHT_COMPOSITION = 0.5;
/** Maximum effect of the roast level on one product, in either direction. */
export const WEIGHT_ROAST = 0.2;

/*
 * The strength answer scores 3 for an exact match, 1.5 one step away, so a
 * single step is worth 1.5. Two facts at full strength in the same direction
 * must not be able to add up to that.
 */
export const MAX_FACT_SWING = 2 * (WEIGHT_COMPOSITION + WEIGHT_ROAST);

export type FactCriterion = "composition" | "roast";

/** Which way a fact leans for a taste answer: +1 more of it, -1 less, 0 not at all. */
interface Leaning {
  /** +1: a higher arabica share supports the answer. -1: a lower one does. */
  readonly arabica: -1 | 0 | 1;
  /** +1: a darker roast supports the answer. -1: a lighter one does. */
  readonly darkness: -1 | 0 | 1;
}

/**
 * Option by option, whether composition or roast is evidence for the
 * preference, and why. Every entry here is a claim a reviewer can dispute, so
 * every entry says what it rests on.
 */
export const TASTE_LEANING: Readonly<Record<TasteAnswer, Leaning>> = {
  /*
   * "Меко и балансирано — за сутрин, често с мляко. Без горчивина."
   *
   * Arabica is the gentler species and robusta the harsher, more bitter one;
   * that is as close to common ground as coffee gets. And a darker roast is a
   * more bitter one, because bitterness develops with roasting. "Без
   * горчивина" is the one thing this option says outright, and both facts
   * speak to exactly that — so both lean toward it.
   */
  mild: { arabica: 1, darkness: -1 },

  /*
   * "Класическо еспресо — плътно, с крема, каквото се пие в Италия."
   *
   * No honest direction. Classic espresso is made from pure arabica and from
   * arabica-robusta blends, and Italian roasts run from medium to dark
   * depending on the house; nothing in the option picks one of those. The
   * crema argument for some robusta is true but it is an argument for a
   * preference the customer did not state. Strength and intensity already
   * place the product on this option.
   */
  classic: { arabica: 0, darkness: 0 },

  /*
   * "Силно и наситено — максимален характер, събужда веднага."
   *
   * Roast: a darker roast has the more pronounced roasted flavour, which is
   * what "наситено" asks for. (Not caffeine — roasting does not add any, so
   * nothing is claimed about waking up.)
   *
   * Arabica: deliberately not used. The only thing that would count for this
   * option is a robusta-heavy blend, and the data cannot show one — a
   * "100% робуста" page stores no arabica figure, and a figure below 100 does
   * not say what the rest is. Marking down pure arabica for "maximum
   * character" would also assert something nobody has shown: that arabica
   * lacks it.
   */
  intense: { arabica: 0, darkness: 1 },
};

/* --- Reading the stored values ------------------------------------------ */

/** A stored arabica share if it is a usable one; anything else is "not stated". */
export function readArabicaShare(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

/**
 * The roast levels the parser normalises to, lightest first. The stored text
 * can also be a labelled value copied as the page wrote it, which may be
 * anything; only these levels are understood, and anything else is "not
 * stated" rather than guessed at.
 */
const ROAST_LEVELS = ["светло", "леко", "средно", "средно тъмно", "тъмно"] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/** 0 lightest .. 3 darkest. "леко" is the source's other word for a light roast. */
const ROAST_DARKNESS: Readonly<Record<RoastLevel, number>> = {
  светло: 0,
  леко: 0,
  средно: 1,
  "средно тъмно": 2,
  тъмно: 3,
};

export function readRoastLevel(value: string | null | undefined): RoastLevel | null {
  if (typeof value !== "string") return null;
  const normalised = value
    .toLowerCase()
    .replace(/[\s-]+/gu, " ")
    .replace(/ изпичане$/u, "")
    .trim();
  return (ROAST_LEVELS as readonly string[]).includes(normalised)
    ? (normalised as RoastLevel)
    : null;
}

/* --- Criteria ------------------------------------------------------------ */

export interface FactEvidence {
  readonly criterion: FactCriterion;
  /** Added to the score. Zero when the fact is absent or does not bear on the answer. */
  readonly contribution: number;
  /** A phrase for the card, only when the fact supported the answer. */
  readonly reason: string | null;
}

/** Arabica share at or above which the card says so; below it the lean is too slight to state. */
const ARABICA_REASON_FROM = 80;

/**
 * Arabica share as evidence for a taste answer.
 *
 * Centred on half-and-half: a majority of arabica leans one way, a minority the
 * other, 50% is exactly neutral — the same as not knowing.
 */
export function compositionEvidence(
  taste: TasteAnswer,
  arabicaPercent: number | null | undefined,
): FactEvidence {
  const none: FactEvidence = { criterion: "composition", contribution: 0, reason: null };
  const lean = TASTE_LEANING[taste].arabica;
  const share = readArabicaShare(arabicaPercent);
  if (lean === 0 || share === null) return none;

  const contribution = lean * WEIGHT_COMPOSITION * ((share - 50) / 50);
  let reason: string | null = null;
  /*
   * The phrase states the fact and a property of the species, not a verdict on
   * the product: whether this coffee is mild is the strength answer's business,
   * and a strong blend that happens to be pure arabica must not be called mild
   * on its own card. Only the mild option leans on arabica, so only its wording
   * exists; a new leaning must bring its own phrase rather than inherit this one.
   */
  if (taste === "mild" && lean === 1 && share >= ARABICA_REASON_FROM) {
    reason = `${share === 100 ? "изцяло арабика" : `${share}% арабика`} — арабиката е по-мека от робустата`;
  }
  return { criterion: "composition", contribution, reason };
}

/**
 * Roast level as evidence for a taste answer.
 *
 * Centred between medium and medium-dark: the two lighter levels lean one way,
 * the two darker ones the other, in proportion to how far from the middle.
 */
export function roastEvidence(taste: TasteAnswer, roast: string | null | undefined): FactEvidence {
  const none: FactEvidence = { criterion: "roast", contribution: 0, reason: null };
  const lean = TASTE_LEANING[taste].darkness;
  const level = readRoastLevel(roast);
  if (lean === 0 || level === null) return none;

  const position = (ROAST_DARKNESS[level] - 1.5) / 1.5; // -1 lightest .. +1 darkest
  const contribution = lean * WEIGHT_ROAST * position;
  let reason: string | null = null;
  // Each phrase names what it is compared with, so it states a property of the
  // roast level rather than a promise about the whole coffee.
  if (contribution > 0) {
    reason =
      taste === "mild"
        ? `${level} изпичане — по-малко горчиво от тъмното`
        : `${level} изпичане — по-наситен вкус от светлото`;
  }
  return { criterion: "roast", contribution, reason };
}
