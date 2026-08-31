import { parseIntensity } from "@/lib/catalog/attributes";
import type { ProductCardView } from "@/lib/catalog/types";
import { BUDGET_OPTIONS, TASTE_OPTIONS, VOLUME_OPTIONS, type WizardAnswers } from "./answers";

/**
 * Recommendation scoring.
 *
 * A pure function of (answers, candidates). No database, no clock, no network,
 * no randomness — the same inputs always produce the same ranking, which is
 * what makes the ranking testable and what stops "why did it suggest that?"
 * from being unanswerable. The same reasoning applies here as to the diff
 * engine and the circuit breaker in the crawler: the logic that decides
 * something consequential is the logic that must be exhaustively testable.
 *
 * The model has two tiers, and the difference between them matters:
 *
 *  - **Hard rules** remove a product from consideration. There are only three,
 *    and each one exists because the alternative is a purchase the customer
 *    cannot use or explicitly refused.
 *  - **Soft scores** rank what survives. None of them can exclude anything, so
 *    a preference nobody in the catalog satisfies costs the visitor a better
 *    match, never an empty page.
 *
 * Every score contributes a human-readable reason, and the reasons are what
 * the result page shows. A recommendation that cannot explain itself is a
 * filter wearing a costume.
 */

/** What the scorer needs on top of a normal product card. */
export interface RecommendationCandidate extends ProductCardView {
  readonly attributes: Readonly<Record<string, string>>;
  /** Exact decimal string, or null when price or pack size is unknown. */
  readonly pricePerServing: string | null;
  /** Whole servings in the pack. */
  readonly servings: number | null;
  /** True when `servings` was derived from weight rather than a piece count. */
  readonly servingsEstimated: boolean;
}

export interface ScoredRecommendation {
  readonly product: RecommendationCandidate;
  readonly score: number;
  /** Short phrases explaining the match, best first. */
  readonly reasons: readonly string[];
  /** Set when the product is offered despite contradicting an answer. */
  readonly caveat: string | null;
}

export interface RecommendationResult {
  readonly picks: readonly ScoredRecommendation[];
  /**
   * One deliberately different suggestion, or null. Never a near-duplicate of
   * the picks, and never shown when there is nothing genuinely different.
   */
  readonly alternative: ScoredRecommendation | null;
  /**
   * Answers that had to be set aside to produce any result at all, in the
   * order they were dropped. Empty when nothing was relaxed.
   */
  readonly relaxed: readonly RelaxedConstraint[];
  /** Candidates that survived the hard rules. */
  readonly eligibleCount: number;
}

export interface RelaxedConstraint {
  readonly key: "decaf" | "flavoured" | "plain";
  readonly message: string;
}

const STRENGTH_RANK: Record<string, number> = { weak: 0, medium: 1, strong: 2 };

/* --- Weights ------------------------------------------------------------ *
 *
 * Deliberately few and deliberately flat. With 110 products a finely tuned
 * model would be fitting noise; these are ordered by how confident we are that
 * the answer means what it says. Taste is asked directly and answered
 * concretely, so it leads. Pack size is a fact about the pack rather than a
 * preference, so it follows. Price is last because it is the dimension the
 * visitor can judge for themselves once they see the number.
 */
const WEIGHT_STRENGTH = 3;
const WEIGHT_INTENSITY = 2;
const WEIGHT_PACK_FIT = 1.5;
const WEIGHT_PRICE = 2;
/** Applied when nothing was asked about flavouring and the product is flavoured. */
const PENALTY_UNREQUESTED_FLAVOUR = 1.5;

export function scoreRecommendations(
  answers: WizardAnswers,
  candidates: readonly RecommendationCandidate[],
  options: { readonly limit?: number } = {},
): RecommendationResult {
  const limit = options.limit ?? 3;
  const { eligible, relaxed } = applyHardRules(answers, candidates);

  const scored = eligible
    .map((product) => scoreOne(answers, product, eligible))
    .sort(compareScored);

  const picks = pickDiverse(scored, limit);
  return {
    picks,
    alternative: pickAlternative(scored, picks),
    relaxed,
    eligibleCount: eligible.length,
  };
}

/* --- Hard rules --------------------------------------------------------- */

/**
 * Apply the rules that exclude, relaxing them one at a time rather than ever
 * returning nothing.
 *
 * Order matters: the least meaningful constraint is given up first. Somebody
 * who asked for decaf usually has a reason that is not about taste, so that
 * requirement is the last thing surrendered — and when it is surrendered the
 * result page says so in as many words, because silently serving caffeinated
 * coffee to someone who asked for decaf is the one failure here that could
 * actually matter to a person.
 */
function applyHardRules(
  answers: WizardAnswers,
  candidates: readonly RecommendationCandidate[],
): { eligible: readonly RecommendationCandidate[]; relaxed: readonly RelaxedConstraint[] } {
  const wantsDecaf = answers.requirements.includes("decaf");
  const wantsFlavoured = answers.requirements.includes("flavoured");
  const wantsPlain = answers.requirements.includes("plain");

  const filters: Array<{
    readonly key: RelaxedConstraint["key"];
    readonly message: string;
    readonly test: (product: RecommendationCandidate) => boolean;
  }> = [];

  if (wantsFlavoured) {
    filters.push({
      key: "flavoured",
      message: "Нямаме ароматизирано кафе за тази машина, затова показваме неароматизирано.",
      test: (product) => product.attributes.aromas === "yes",
    });
  }
  if (wantsPlain) {
    filters.push({
      key: "plain",
      message: "За тази машина имаме само ароматизирано кафе.",
      test: (product) => product.attributes.aromas !== "yes",
    });
  }
  filters.push(
    wantsDecaf
      ? {
          key: "decaf",
          message:
            "Нямаме кафе без кофеин за тази машина. Показаното съдържа кофеин — обадете ни се и ще потърсим вариант.",
          test: (product) => product.attributes.decaf === "yes",
        }
      : {
          /*
           * Decaf is excluded unless it was asked for. Nobody who answered
           * "strong and intense" wants a decaffeinated coffee, and with five
           * decaf products in the catalog the chance of one drifting into a
           * general recommendation is real.
           *
           * When it has to be relaxed the visitor is told, because at that
           * point we are showing decaffeinated coffee to somebody who never
           * asked for it — exactly the case that must not pass in silence. One
           * system in this catalog holds a single product and it happens to be
           * decaffeinated, so this is not hypothetical.
           */
          key: "decaf",
          message: "Единственото, което имаме за тази система, е без кофеин.",
          test: (product) => product.attributes.decaf !== "yes",
        },
  );

  let eligible = candidates;
  const relaxed: RelaxedConstraint[] = [];

  for (const filter of filters) {
    const next = eligible.filter(filter.test);
    if (next.length > 0) {
      eligible = next;
      continue;
    }
    // Nothing satisfies this rule. Keep what we have, and say why on the page
    // rather than letting the contradiction pass unremarked.
    if (filter.message) relaxed.push({ key: filter.key, message: filter.message });
  }

  return { eligible, relaxed };
}

/* --- Soft scoring ------------------------------------------------------- */

function scoreOne(
  answers: WizardAnswers,
  product: RecommendationCandidate,
  pool: readonly RecommendationCandidate[],
): ScoredRecommendation {
  let score = 0;
  const reasons: string[] = [];

  const taste = TASTE_OPTIONS.find((option) => option.value === answers.taste) ?? null;
  if (taste) {
    const productStrength = product.attributes.strength;
    const wanted = STRENGTH_RANK[taste.strength];
    const actual = STRENGTH_RANK[productStrength ?? ""];

    if (actual !== undefined && wanted !== undefined) {
      const distance = Math.abs(actual - wanted);
      // Exact match scores full; one step away scores half; two steps nothing.
      score += WEIGHT_STRENGTH * Math.max(0, 1 - distance / 2);
      if (distance === 0) reasons.push(taste.label.toLowerCase());
    }

    const intensity = parseIntensity(product.attributes.intensity);
    if (intensity) {
      const closeness = 1 - Math.abs(intensity.fraction - taste.intensityTarget);
      score += WEIGHT_INTENSITY * Math.max(0, closeness);
      if (closeness > 0.8) {
        reasons.push(`интензивност ${intensity.value} от ${intensity.max}`);
      }
    }
  }

  const volume = VOLUME_OPTIONS.find((option) => option.value === answers.volume) ?? null;
  if (volume && product.servings !== null) {
    /*
     * Pack fit is a ratio, not a difference: for a light drinker a 250-serving
     * pack is as wrong as a 20-serving pack is for an office, and the penalty
     * should be symmetric in proportion rather than in absolute cups.
     */
    const ratio = product.servings / volume.servingsTarget;
    const fit = ratio >= 1 ? Math.min(1, 1 / ratio) : ratio;
    score += WEIGHT_PACK_FIT * fit;
    if (fit > 0.6) {
      reasons.push(
        product.servingsEstimated
          ? `около ${product.servings} чаши в опаковка`
          : `${product.servings} чаши в опаковка`,
      );
    }
  }

  const budget = BUDGET_OPTIONS.find((option) => option.value === answers.budget) ?? null;
  if (budget && budget.value !== "any" && product.pricePerServing !== null) {
    /*
     * Scored against the candidates' own price range rather than a fixed
     * ceiling. Beans run about EUR 0.09–0.16 a cup and capsules EUR 0.25–0.54,
     * so a fixed "budget" threshold would empty one of the two systems
     * entirely while telling capsule buyers nothing.
     */
    const position = pricePosition(product.pricePerServing, pool);
    if (position !== null) {
      const weight = budget.value === "cheap" ? WEIGHT_PRICE : WEIGHT_PRICE / 2;
      score += weight * (1 - position);
      if (position <= 0.25) reasons.push("едно от най-изгодните на чаша");
    }
  }

  /*
   * Flavoured coffee is a strong preference in both directions. Someone who
   * did not ask for hazelnut almost certainly does not want it, so it is
   * pushed down — but not excluded, because for a system where most of the
   * range is flavoured, excluding it would empty the page.
   */
  const flavourAsked =
    answers.requirements.includes("flavoured") || answers.requirements.includes("plain");
  if (!flavourAsked && product.attributes.aromas === "yes") {
    score -= PENALTY_UNREQUESTED_FLAVOUR;
  }
  if (answers.requirements.includes("flavoured") && product.attributes.aromas === "yes") {
    reasons.push("ароматизирано");
  }
  if (answers.requirements.includes("decaf") && product.attributes.decaf === "yes") {
    reasons.push("без кофеин");
  }

  return {
    product,
    score,
    reasons,
    caveat: caveatFor(answers, product),
  };
}

/**
 * Where a price sits within the candidate pool, 0 (cheapest) to 1 (dearest).
 *
 * Comparison is on the exact decimal strings converted to a number only for
 * ordering, never for arithmetic that reaches the customer: the displayed
 * price stays the exact string all the way to the formatter.
 */
function pricePosition(price: string, pool: readonly RecommendationCandidate[]): number | null {
  const prices = pool
    .map((product) => product.pricePerServing)
    .filter((value): value is string => value !== null)
    .map(Number)
    .filter(Number.isFinite);

  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return null;

  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** A product shown despite contradicting something the visitor asked for. */
function caveatFor(answers: WizardAnswers, product: RecommendationCandidate): string | null {
  if (answers.requirements.includes("decaf")) {
    return product.attributes.decaf === "yes" ? null : "Съдържа кофеин";
  }
  /*
   * Decaf nobody asked for. It only reaches a result when it was the only
   * thing available, and the card has to say so: "strong espresso" and "no
   * caffeine" is not a difference a customer should discover at home.
   */
  if (product.attributes.decaf === "yes") return "Без кофеин";
  if (answers.requirements.includes("plain") && product.attributes.aromas === "yes") {
    return "Ароматизирано";
  }
  if (answers.requirements.includes("flavoured") && product.attributes.aromas !== "yes") {
    return "Неароматизирано";
  }
  return null;
}

function compareScored(a: ScoredRecommendation, b: ScoredRecommendation): number {
  if (b.score !== a.score) return b.score - a.score;
  // Ties broken deterministically, so the same answers always rank the same.
  return a.product.slug.localeCompare(b.product.slug, "bg");
}

/**
 * Take the best products, but not three versions of the same one.
 *
 * The catalog genuinely holds the same blend in two pack sizes and several
 * near-identical espresso blends per brand. Three suggestions that differ only
 * in the number on the bag look like a broken recommender, so a brand is only
 * repeated once the distinct brands run out.
 */
function pickDiverse(
  scored: readonly ScoredRecommendation[],
  limit: number,
): readonly ScoredRecommendation[] {
  const picks: ScoredRecommendation[] = [];
  const seenBrands = new Set<string>();

  for (const entry of scored) {
    if (picks.length >= limit) break;
    const brand = entry.product.brand?.slug ?? entry.product.id;
    if (seenBrands.has(brand)) continue;
    seenBrands.add(brand);
    picks.push(entry);
  }

  // Fill any remaining slots once every brand has been offered once.
  for (const entry of scored) {
    if (picks.length >= limit) break;
    if (picks.includes(entry)) continue;
    picks.push(entry);
  }

  return picks;
}

/**
 * One suggestion that is deliberately not the obvious answer.
 *
 * Taken from the better half of the ranking rather than the tail — an
 * alternative should be a real option, not the worst thing in stock — and only
 * when it differs from every pick in brand and in strength, so "something
 * different" means it.
 */
function pickAlternative(
  scored: readonly ScoredRecommendation[],
  picks: readonly ScoredRecommendation[],
): ScoredRecommendation | null {
  if (scored.length <= picks.length) return null;

  const pickedBrands = new Set(picks.map((entry) => entry.product.brand?.slug ?? entry.product.id));
  const pickedStrengths = new Set(picks.map((entry) => entry.product.attributes.strength));
  const upperHalf = scored.slice(0, Math.max(picks.length + 1, Math.ceil(scored.length / 2)));

  for (const entry of upperHalf) {
    if (picks.includes(entry)) continue;
    const brand = entry.product.brand?.slug ?? entry.product.id;
    if (pickedBrands.has(brand)) continue;
    if (pickedStrengths.has(entry.product.attributes.strength)) continue;
    return entry;
  }
  return null;
}
