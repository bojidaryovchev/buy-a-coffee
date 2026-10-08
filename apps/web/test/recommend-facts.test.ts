import { describe, expect, it } from "vitest";
import {
  BUDGET_OPTIONS,
  REQUIREMENT_OPTIONS,
  TASTE_OPTIONS,
  VOLUME_OPTIONS,
  type RequirementAnswer,
  type TasteAnswer,
  type WizardAnswers,
} from "@/lib/recommend/answers";
import {
  MAX_FACT_SWING,
  TASTE_LEANING,
  WEIGHT_COMPOSITION,
  WEIGHT_ROAST,
  compositionEvidence,
  readArabicaShare,
  readRoastLevel,
  roastEvidence,
} from "@/lib/recommend/facts";
import { scoreRecommendations, type RecommendationCandidate } from "@/lib/recommend/score";

/*
 * The stated facts — arabica share and roast — as soft evidence for the taste
 * answer. What is pinned here, in order: with no facts nothing changes; each
 * criterion on its own; absence is neutral; a phrase appears only when its
 * criterion contributed and never for an unset fact; facts never beat a hard
 * rule or the strength answer; and the whole thing is deterministic.
 */

/* --- Fixtures ----------------------------------------------------------- */

let sequence = 0;

interface Overrides {
  name?: string;
  brand?: string;
  strength?: string;
  intensity?: string;
  decaf?: "yes" | "no";
  aromas?: "yes" | "no";
  servings?: number | null;
  pricePerServing?: string | null;
  arabicaPercent?: number | null;
  origin?: string | null;
  roast?: string | null;
}

function candidate(overrides: Overrides = {}): RecommendationCandidate {
  sequence += 1;
  const name = overrides.name ?? `product-${sequence}`;
  const brand = overrides.brand ?? `brand-${sequence}`;
  return {
    id: `id-${sequence}`,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    price: { amount: "10.00", currency: "EUR", formatted: "10,00 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1кг.",
    intensity: overrides.intensity ?? null,
    systemId: null,
    servingPrice: null,
    brand: { slug: brand, name: brand },
    image: null,
    shortDescription: null,
    attributes: {
      strength: overrides.strength ?? "medium",
      decaf: overrides.decaf ?? "no",
      aromas: overrides.aromas ?? "no",
      ...(overrides.intensity ? { intensity: overrides.intensity } : {}),
    },
    pricePerServing: overrides.pricePerServing ?? "0.2000",
    servings: overrides.servings ?? 100,
    servingsEstimated: false,
    arabicaPercent: overrides.arabicaPercent ?? null,
    origin: overrides.origin ?? null,
    roast: overrides.roast ?? null,
  };
}

const answersOf = (partial: Partial<WizardAnswers> = {}): WizardAnswers => ({
  brew: "capsule",
  system: "nespresso-original",
  machine: null,
  taste: null,
  volume: null,
  budget: null,
  requirements: [],
  ...partial,
});

/** Score of each product in a pool, by name, with every product eligible. */
function scoresByName(
  answers: WizardAnswers,
  pool: readonly RecommendationCandidate[],
): Record<string, number> {
  // A large limit so the diversity rule never hides anyone from the comparison.
  const result = scoreRecommendations(answers, pool, { limit: pool.length });
  return Object.fromEntries(result.picks.map((entry) => [entry.product.name, entry.score]));
}

function onlyScore(answers: WizardAnswers, product: RecommendationCandidate): number {
  const result = scoreRecommendations(answers, [product]);
  return result.picks[0]?.score ?? Number.NaN;
}

const TASTES = TASTE_OPTIONS.map((option) => option.value);
const REQUIREMENT_SETS: readonly (readonly RequirementAnswer[])[] = [
  [],
  ["decaf"],
  ["flavoured"],
  ["plain"],
  ["decaf", "flavoured"],
  ["decaf", "plain"],
];

/** Every combination of answers the wizard can produce, unanswered included. */
function allAnswerSets(): WizardAnswers[] {
  const sets: WizardAnswers[] = [];
  for (const taste of [null, ...TASTES]) {
    for (const volume of [null, ...VOLUME_OPTIONS.map((o) => o.value)]) {
      for (const budget of [null, ...BUDGET_OPTIONS.map((o) => o.value)]) {
        for (const requirements of REQUIREMENT_SETS) {
          sets.push(answersOf({ taste, volume, budget, requirements }));
        }
      }
    }
  }
  return sets;
}

/** A pool with variety on every axis the scorer already uses. */
function legacyPool(withFacts: (index: number) => Partial<Overrides>): RecommendationCandidate[] {
  const strengths = ["weak", "medium", "strong"];
  const pool: RecommendationCandidate[] = [];
  for (let i = 0; i < 12; i += 1) {
    pool.push(
      candidate({
        name: `Продукт ${i}`,
        brand: `brand-${i % 5}`,
        strength: strengths[i % 3],
        intensity: i % 4 === 0 ? undefined : `${(i % 12) + 1} от 12`,
        decaf: i === 7 ? "yes" : "no",
        aromas: i % 5 === 0 ? "yes" : "no",
        servings: [20, 60, 120, 250, 400][i % 5],
        pricePerServing: (0.1 + i * 0.037).toFixed(4),
        ...withFacts(i),
      }),
    );
  }
  return pool;
}

/* --- 1. Null facts change nothing --------------------------------------- */

describe("with no stated facts", () => {
  /*
   * Every product in the catalog today. The ranking, the scores and every
   * reason must be exactly what they were before the criteria existed; the
   * contribution of an absent fact is a literal zero, not a small number.
   */
  const unset = () => legacyPool(() => ({}));

  it("scores every product exactly as the scorer did before the facts existed", () => {
    // Expected values worked out from the weights, not read back from the scorer:
    // strength 3, intensity 2 * (1 - |fraction - target|), pack fit 1.5.
    const pool = [
      candidate({ name: "Силно", brand: "a", strength: "strong", intensity: "11 от 12" }),
      candidate({ name: "Средно", brand: "b", strength: "medium" }),
    ];
    const scores = scoresByName(answersOf({ taste: "intense", volume: "regular" }), pool);
    const fit = 1.5 * (100 / 120);
    expect(scores["Силно"]).toBeCloseTo(3 + 2 * (1 - Math.abs(11 / 12 - 0.9)) + fit, 10);
    expect(scores["Средно"]).toBeCloseTo(1.5 + fit, 10);
  });

  it("is indistinguishable from omitting the facts, for every combination of answers", () => {
    const withNull = unset();
    const omitted = withNull.map((product) => {
      // The shape of a candidate from before the three keys existed.
      const keys = ["arabicaPercent", "origin", "roast"];
      return Object.fromEntries(
        Object.entries(product).filter(([key]) => !keys.includes(key)),
      ) as unknown as RecommendationCandidate;
    });

    const sets = allAnswerSets();
    expect(sets.length).toBeGreaterThan(300);
    // The product objects differ by the three keys themselves, so compare
    // what the scorer produced: order, score, reasons and caveat of each entry.
    const outcome = (result: ReturnType<typeof scoreRecommendations>) => ({
      picks: result.picks.map((e) => [e.product.slug, e.score, e.reasons, e.caveat]),
      alternative: result.alternative?.product.slug ?? null,
      relaxed: result.relaxed,
      eligibleCount: result.eligibleCount,
    });
    for (const answers of sets) {
      const result = scoreRecommendations(answers, withNull, { limit: 12 });
      expect(outcome(result)).toEqual(
        outcome(scoreRecommendations(answers, omitted, { limit: 12 })),
      );
      // The only new field; empty when nothing was stated.
      expect(result.factsUsed).toEqual([]);
    }
  });

  it("produces no fact reason and no fact adjustment for any answer", () => {
    for (const answers of allAnswerSets()) {
      const result = scoreRecommendations(answers, unset(), { limit: 12 });
      expect(result.factsUsed).toEqual([]);
      for (const entry of result.picks) {
        for (const reason of entry.reasons) {
          expect(reason).not.toMatch(/арабика|изпичане/);
        }
      }
    }
  });

  it("keeps a fixed ranking and its reasons", () => {
    const result = scoreRecommendations(
      answersOf({ taste: "intense", volume: "regular", budget: "cheap" }),
      [
        candidate({
          name: "Силно",
          brand: "a",
          strength: "strong",
          intensity: "11 от 12",
          servings: 120,
          pricePerServing: "0.1000",
        }),
        candidate({ name: "Средно", brand: "b", servings: 120, pricePerServing: "0.3000" }),
        candidate({ name: "Меко", brand: "c", strength: "weak", servings: 120 }),
      ],
    );
    expect(result.picks.map((entry) => entry.product.name)).toEqual(["Силно", "Средно", "Меко"]);
    expect(result.picks[0]?.reasons).toEqual([
      "силно и наситено",
      "интензивност 11 от 12",
      "120 чаши в опаковка",
      "едно от най-изгодните на чаша",
    ]);
  });
});

/* --- 2. Each criterion in isolation ------------------------------------- */

describe("arabica share", () => {
  const mild = answersOf({ taste: "mild" });
  const reasonFor = (arabicaPercent: number | null) =>
    scoreRecommendations(mild, [candidate({ strength: "weak", arabicaPercent })]).picks[0]
      ?.reasons ?? [];

  it("lifts a mostly-arabica coffee for a mild preference, and lowers a mostly-other one", () => {
    const pool = [
      candidate({ name: "Сто", brand: "a", strength: "weak", arabicaPercent: 100 }),
      candidate({ name: "Седемдесет", brand: "b", strength: "weak", arabicaPercent: 70 }),
      candidate({ name: "Тридесет", brand: "c", strength: "weak", arabicaPercent: 30 }),
    ];
    const scores = scoresByName(mild, pool);
    expect(scores["Сто"]).toBeGreaterThan(scores["Седемдесет"]!);
    expect(scores["Седемдесет"]).toBeGreaterThan(scores["Тридесет"]!);
  });

  it("is worth exactly its weight at the extremes", () => {
    const base = onlyScore(mild, candidate({ strength: "weak" }));
    expect(
      onlyScore(mild, candidate({ strength: "weak", arabicaPercent: 100 })) - base,
    ).toBeCloseTo(WEIGHT_COMPOSITION, 10);
    expect(onlyScore(mild, candidate({ strength: "weak", arabicaPercent: 0 })) - base).toBeCloseTo(
      -WEIGHT_COMPOSITION,
      10,
    );
  });

  it("states a pure-arabica coffee as such, with the reason it matched", () => {
    expect(reasonFor(100)).toContain("изцяло арабика — арабиката е по-мека от робустата");
  });

  it("states the figure for a high but not total share", () => {
    expect(reasonFor(85)).toContain("85% арабика — арабиката е по-мека от робустата");
    expect(reasonFor(80)).toContain("80% арабика — арабиката е по-мека от робустата");
  });

  it("leans, but stays quiet, for a modest majority", () => {
    expect(reasonFor(70).join(" ")).not.toMatch(/арабика/);
    const base = onlyScore(mild, candidate({ strength: "weak" }));
    expect(onlyScore(mild, candidate({ strength: "weak", arabicaPercent: 70 }))).toBeGreaterThan(
      base,
    );
  });

  it("never gives a reason for a share that works against the answer", () => {
    expect(reasonFor(20).join(" ")).not.toMatch(/арабика/);
    expect(reasonFor(0).join(" ")).not.toMatch(/арабика/);
  });

  it("does not bear on the classic or the intense preference", () => {
    for (const taste of ["classic", "intense"] as const) {
      const answers = answersOf({ taste });
      const wanted = TASTE_OPTIONS.find((option) => option.value === taste)!.strength;
      const base = onlyScore(answers, candidate({ strength: wanted }));
      for (const arabicaPercent of [0, 30, 50, 70, 100]) {
        const product = candidate({ strength: wanted, arabicaPercent });
        expect(onlyScore(answers, product)).toBe(base);
        expect(scoreRecommendations(answers, [product]).picks[0]?.reasons.join(" ")).not.toMatch(
          /арабика/,
        );
      }
    }
  });
});

describe("roast", () => {
  const mild = answersOf({ taste: "mild" });
  const intense = answersOf({ taste: "intense" });

  const score = (answers: WizardAnswers, strength: string, roast: string | null) =>
    onlyScore(answers, candidate({ strength, roast }));
  const reasons = (answers: WizardAnswers, strength: string, roast: string | null) =>
    scoreRecommendations(answers, [candidate({ strength, roast })]).picks[0]?.reasons ?? [];

  it("favours a lighter roast for a mild preference, in order of lightness", () => {
    const light = score(mild, "weak", "светло");
    const medium = score(mild, "weak", "средно");
    const mediumDark = score(mild, "weak", "средно тъмно");
    const dark = score(mild, "weak", "тъмно");
    expect(light).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(mediumDark);
    expect(mediumDark).toBeGreaterThan(dark);
    expect(score(mild, "weak", "леко")).toBe(light);
  });

  it("favours a darker roast for an intense preference, in order of darkness", () => {
    const dark = score(intense, "strong", "тъмно");
    const mediumDark = score(intense, "strong", "средно тъмно");
    const medium = score(intense, "strong", "средно");
    const light = score(intense, "strong", "светло");
    expect(dark).toBeGreaterThan(mediumDark);
    expect(mediumDark).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(light);
  });

  it("is worth exactly its weight at the extremes", () => {
    const base = score(mild, "weak", null);
    expect(score(mild, "weak", "светло") - base).toBeCloseTo(WEIGHT_ROAST, 10);
    expect(score(mild, "weak", "тъмно") - base).toBeCloseTo(-WEIGHT_ROAST, 10);
  });

  it("states the roast it used, and only when it supported the answer", () => {
    expect(reasons(mild, "weak", "светло")).toContain(
      "светло изпичане — по-малко горчиво от тъмното",
    );
    expect(reasons(mild, "weak", "средно")).toContain(
      "средно изпичане — по-малко горчиво от тъмното",
    );
    expect(reasons(mild, "weak", "средно тъмно").join(" ")).not.toMatch(/изпичане/);
    expect(reasons(mild, "weak", "тъмно").join(" ")).not.toMatch(/изпичане/);

    expect(reasons(intense, "strong", "тъмно")).toContain(
      "тъмно изпичане — по-наситен вкус от светлото",
    );
    expect(reasons(intense, "strong", "средно тъмно")).toContain(
      "средно тъмно изпичане — по-наситен вкус от светлото",
    );
    expect(reasons(intense, "strong", "средно").join(" ")).not.toMatch(/изпичане/);
    expect(reasons(intense, "strong", "светло").join(" ")).not.toMatch(/изпичане/);
  });

  it("does not bear on the classic preference", () => {
    const classic = answersOf({ taste: "classic" });
    const base = score(classic, "medium", null);
    for (const roast of ["светло", "леко", "средно", "средно тъмно", "тъмно"]) {
      expect(score(classic, "medium", roast)).toBe(base);
      expect(reasons(classic, "medium", roast).join(" ")).not.toMatch(/изпичане/);
    }
  });

  it("reads the level however the source wrote it, and nothing it cannot read", () => {
    expect(readRoastLevel("Средно-тъмно")).toBe("средно тъмно");
    expect(readRoastLevel("тъмно изпичане")).toBe("тъмно");
    expect(readRoastLevel(" СВЕТЛО ")).toBe("светло");
    expect(readRoastLevel("италианско")).toBeNull();
    expect(readRoastLevel("по-тъмно")).toBeNull();
    expect(readRoastLevel("")).toBeNull();
    expect(readRoastLevel(null)).toBeNull();
  });
});

describe("origin", () => {
  it("never moves the score or produces a reason, whatever the answers", () => {
    for (const answers of allAnswerSets()) {
      const base = legacyPool(() => ({}));
      const withOrigin = legacyPool((i) => ({ origin: i % 2 ? "Бразилия" : "Уганда и Индия" }));
      const a = scoreRecommendations(answers, base, { limit: 12 });
      const b = scoreRecommendations(answers, withOrigin, { limit: 12 });
      expect(b.picks.map((e) => [e.product.slug, e.score, e.reasons])).toEqual(
        a.picks.map((e) => [e.product.slug, e.score, e.reasons]),
      );
      expect(b.factsUsed).toEqual([]);
    }
  });
});

describe("answers that are not about taste", () => {
  it("never let a fact move the score", () => {
    const withFacts = legacyPool((i) => ({
      arabicaPercent: [100, 40, null][i % 3],
      roast: ["светло", "тъмно", null][i % 3],
    }));
    const without = legacyPool(() => ({}));

    for (const volume of [null, ...VOLUME_OPTIONS.map((o) => o.value)]) {
      for (const budget of [null, ...BUDGET_OPTIONS.map((o) => o.value)]) {
        for (const requirements of REQUIREMENT_SETS) {
          const answers = answersOf({ taste: null, volume, budget, requirements });
          const a = scoreRecommendations(answers, withFacts, { limit: 12 });
          const b = scoreRecommendations(answers, without, { limit: 12 });
          expect(a.picks.map((e) => [e.product.slug, e.score, e.reasons])).toEqual(
            b.picks.map((e) => [e.product.slug, e.score, e.reasons]),
          );
          expect(a.factsUsed).toEqual([]);
        }
      }
    }
  });
});

/* --- 3. Absence is neutral ---------------------------------------------- */

describe("a missing fact is neutral", () => {
  const mild = answersOf({ taste: "mild" });
  const intense = answersOf({ taste: "intense" });

  it("scores two otherwise identical products alike when one's share is unstated and the other's is at the midpoint", () => {
    const unstated = onlyScore(mild, candidate({ strength: "weak" }));
    expect(onlyScore(mild, candidate({ strength: "weak", arabicaPercent: 50 }))).toBe(unstated);
  });

  it("sits between a supporting and a contradicting figure, never below the worst or above the best", () => {
    const pool = [
      candidate({ name: "Няма данни", brand: "a", strength: "weak" }),
      candidate({ name: "Подкрепя", brand: "b", strength: "weak", arabicaPercent: 95 }),
      candidate({ name: "Противоречи", brand: "c", strength: "weak", arabicaPercent: 10 }),
    ];
    const scores = scoresByName(mild, pool);
    expect(scores["Подкрепя"]).toBeGreaterThan(scores["Няма данни"]!);
    expect(scores["Няма данни"]).toBeGreaterThan(scores["Противоречи"]!);
  });

  it("gives a product with a fact no edge on average: across every possible share the fact nets out to nothing", () => {
    const base = onlyScore(mild, candidate({ strength: "weak" }));
    let total = 0;
    for (let share = 0; share <= 100; share += 1) {
      total += onlyScore(mild, candidate({ strength: "weak", arabicaPercent: share })) - base;
    }
    expect(total / 101).toBeCloseTo(0, 10);
  });

  it("does the same for roast: the four levels net out to nothing", () => {
    for (const answers of [mild, intense]) {
      const strength = answers.taste === "mild" ? "weak" : "strong";
      const base = onlyScore(answers, candidate({ strength }));
      const levels = ["светло", "средно", "средно тъмно", "тъмно"];
      const net = levels.reduce(
        (sum, roast) => sum + onlyScore(answers, candidate({ strength, roast })) - base,
        0,
      );
      expect(net).toBeCloseTo(0, 10);
    }
  });

  it("treats a figure or level it cannot use exactly like no figure", () => {
    const base = onlyScore(mild, candidate({ strength: "weak" }));
    for (const arabicaPercent of [-1, 101, 150, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(onlyScore(mild, candidate({ strength: "weak", arabicaPercent }))).toBe(base);
    }
    for (const roast of ["", "   ", "италианско", "по-тъмно", "тъмно-тъмно", "dark"]) {
      expect(onlyScore(mild, candidate({ strength: "weak", roast }))).toBe(base);
      expect(onlyScore(intense, candidate({ strength: "strong", roast }))).toBe(
        onlyScore(intense, candidate({ strength: "strong" })),
      );
    }
    expect(readArabicaShare(Number.NaN)).toBeNull();
    expect(readArabicaShare(undefined)).toBeNull();
    expect(readArabicaShare(0)).toBe(0);
    expect(readArabicaShare(100)).toBe(100);
  });

  it("makes no claim about a coffee whose composition is not stated, even beside one that states it", () => {
    const result = scoreRecommendations(mild, [
      candidate({ name: "Неизвестно", brand: "a", strength: "weak", arabicaPercent: null }),
      candidate({ name: "Известно", brand: "b", strength: "weak", arabicaPercent: 100 }),
    ]);
    const unknown = result.picks.find((entry) => entry.product.name === "Неизвестно");
    expect(unknown?.reasons.join(" ")).not.toMatch(/арабика/);
  });

  it("falls back to the tie-break, not to the product with data, when the score is level", () => {
    const pool = [
      candidate({ name: "Б без данни", brand: "b", strength: "weak" }),
      candidate({
        name: "А със средна стойност",
        brand: "a",
        strength: "weak",
        arabicaPercent: 50,
      }),
    ];
    const result = scoreRecommendations(mild, pool);
    expect(result.picks[0]?.score).toBe(result.picks[1]?.score);
    expect(result.picks.map((entry) => entry.product.slug)).toEqual(
      [...pool].map((p) => p.slug).sort((x, y) => x.localeCompare(y, "bg")),
    );
  });
});

/* --- 4. Reasons claim only what was used -------------------------------- */

describe("reasons", () => {
  it("never mention a fact that is unset, whatever the other facts are", () => {
    for (const taste of TASTES) {
      const answers = answersOf({ taste });
      const pool = [
        candidate({ name: "Само дял", brand: "a", arabicaPercent: 100, roast: null }),
        candidate({ name: "Само изпичане", brand: "b", arabicaPercent: null, roast: "светло" }),
        candidate({ name: "Нищо", brand: "c" }),
      ];
      const result = scoreRecommendations(answers, pool, { limit: 3 });
      const byName = Object.fromEntries(result.picks.map((e) => [e.product.name, e.reasons]));
      expect(byName["Само дял"]!.join(" ")).not.toMatch(/изпичане/);
      expect(byName["Само изпичане"]!.join(" ")).not.toMatch(/арабика/);
      expect(byName["Нищо"]!.join(" ")).not.toMatch(/арабика|изпичане/);
    }
  });

  it("appear only for a criterion that supported the answer and so moved the score", () => {
    const shares = [null, 0, 25, 50, 75, 80, 99, 100];
    const roasts = [null, "светло", "леко", "средно", "средно тъмно", "тъмно", "непознато"];
    for (const taste of TASTES) {
      const answers = answersOf({ taste });
      const leaning = TASTE_LEANING[taste];
      for (const arabicaPercent of shares) {
        for (const roast of roasts) {
          const product = candidate({ arabicaPercent, roast });
          const entry = scoreRecommendations(answers, [product]).picks[0]!;
          const text = entry.reasons.join(" | ");

          const composition = compositionEvidence(taste, arabicaPercent);
          const roasting = roastEvidence(taste, roast);

          // Said → used, and used in the answer's favour.
          if (/арабика/.test(text)) {
            expect(arabicaPercent).not.toBeNull();
            expect(leaning.arabica).not.toBe(0);
            expect(composition.contribution).toBeGreaterThan(0);
          }
          if (/изпичане/.test(text)) {
            expect(readRoastLevel(roast)).not.toBeNull();
            expect(leaning.darkness).not.toBe(0);
            expect(roasting.contribution).toBeGreaterThan(0);
          }
          // Used in the answer's favour and strongly enough to state → said.
          if (composition.reason) expect(entry.reasons).toContain(composition.reason);
          if (roasting.reason) expect(entry.reasons).toContain(roasting.reason);
          // Never states a fact that does not match what is stored.
          if (/\d+% арабика/.test(text)) expect(text).toContain(`${arabicaPercent}% арабика`);
          if (/изпичане/.test(text)) expect(text).toContain(`${readRoastLevel(roast)} изпичане`);
        }
      }
    }
  });

  it("put the new phrases after the taste ones and before pack size", () => {
    const entry = scoreRecommendations(answersOf({ taste: "mild", volume: "light" }), [
      candidate({
        strength: "weak",
        intensity: "4 от 12",
        servings: 60,
        arabicaPercent: 100,
        roast: "светло",
      }),
    ]).picks[0]!;
    expect(entry.reasons).toEqual([
      "меко и балансирано",
      "интензивност 4 от 12",
      "изцяло арабика — арабиката е по-мека от робустата",
      "светло изпичане — по-малко горчиво от тъмното",
      "60 чаши в опаковка",
    ]);
  });

  it("report which criteria moved the picks, for analytics", () => {
    const mild = answersOf({ taste: "mild" });
    expect(
      scoreRecommendations(mild, [candidate({ strength: "weak", arabicaPercent: 90 })]).factsUsed,
    ).toEqual(["composition"]);
    expect(
      scoreRecommendations(mild, [candidate({ strength: "weak", roast: "тъмно" })]).factsUsed,
    ).toEqual(["roast"]);
    expect(
      scoreRecommendations(mild, [
        candidate({ strength: "weak", arabicaPercent: 90, roast: "светло" }),
      ]).factsUsed,
    ).toEqual(["composition", "roast"]);
    // A midpoint figure moves nothing, so it is not "used".
    expect(
      scoreRecommendations(mild, [candidate({ strength: "weak", arabicaPercent: 50 })]).factsUsed,
    ).toEqual([]);
    expect(
      scoreRecommendations(answersOf({ taste: "classic" }), [
        candidate({ arabicaPercent: 90, roast: "светло" }),
      ]).factsUsed,
    ).toEqual([]);
  });
});

/* --- 5. Facts refine; they do not decide --------------------------------- */

describe("weights", () => {
  it("keep both facts together smaller than one step of the strength answer", () => {
    // One step of strength is 1.5; the facts at full strength both ways must fit under it.
    expect(MAX_FACT_SWING).toBeLessThan(1.5);
    expect(MAX_FACT_SWING).toBe(2 * (WEIGHT_COMPOSITION + WEIGHT_ROAST));
  });

  it("never let the best facts lift a strength that was not asked for over one that was", () => {
    const cases: Array<{
      taste: TasteAnswer;
      wanted: string;
      off: string;
      best: Overrides;
      worst: Overrides;
    }> = [
      {
        taste: "mild",
        wanted: "weak",
        off: "medium",
        best: { arabicaPercent: 100, roast: "светло" },
        worst: { arabicaPercent: 0, roast: "тъмно" },
      },
      {
        taste: "intense",
        wanted: "strong",
        off: "medium",
        best: { roast: "тъмно" },
        worst: { roast: "светло" },
      },
    ];
    for (const { taste, wanted, off, best, worst } of cases) {
      const result = scoreRecommendations(answersOf({ taste }), [
        candidate({ name: "Търсено, най-лоши данни", brand: "a", strength: wanted, ...worst }),
        candidate({ name: "Съседно, най-добри данни", brand: "b", strength: off, ...best }),
      ]);
      expect(result.picks[0]?.product.name).toBe("Търсено, най-лоши данни");
    }
  });

  it("do reorder products that the answers could not separate", () => {
    const result = scoreRecommendations(answersOf({ taste: "mild" }), [
      candidate({ name: "А тъмно", brand: "a", strength: "weak", roast: "тъмно" }),
      candidate({ name: "Б светло", brand: "b", strength: "weak", roast: "светло" }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Б светло");
  });
});

/* --- 6. Hard rules still win -------------------------------------------- */

describe("hard rules", () => {
  const BEST = { arabicaPercent: 100, roast: "светло" } as const;

  it("exclude decaf that nobody asked for, however well its facts match", () => {
    const result = scoreRecommendations(answersOf({ taste: "mild" }), [
      candidate({ name: "Без кофеин", brand: "a", strength: "weak", decaf: "yes", ...BEST }),
      candidate({ name: "С кофеин", brand: "b", strength: "weak" }),
    ]);
    expect(result.picks.map((entry) => entry.product.name)).toEqual(["С кофеин"]);
    expect(result.relaxed).toEqual([]);
  });

  it("exclude caffeinated coffee from a decaf request, however well its facts match", () => {
    const result = scoreRecommendations(answersOf({ taste: "mild", requirements: ["decaf"] }), [
      candidate({ name: "Без кофеин", brand: "a", strength: "medium", decaf: "yes" }),
      candidate({ name: "С кофеин", brand: "b", strength: "weak", ...BEST }),
    ]);
    expect(result.picks.map((entry) => entry.product.name)).toEqual(["Без кофеин"]);
  });

  it("exclude the flavoured when plain was asked for, and the plain when flavoured was", () => {
    const pool = [
      candidate({ name: "Ароматизирано", brand: "a", strength: "weak", aromas: "yes", ...BEST }),
      candidate({ name: "Обикновено", brand: "b", strength: "weak" }),
    ];
    const plain = scoreRecommendations(answersOf({ taste: "mild", requirements: ["plain"] }), pool);
    expect(plain.picks.map((entry) => entry.product.name)).toEqual(["Обикновено"]);
    const flavoured = scoreRecommendations(
      answersOf({ taste: "mild", requirements: ["flavoured"] }),
      pool,
    );
    expect(flavoured.picks.map((entry) => entry.product.name)).toEqual(["Ароматизирано"]);
  });

  it("hold for every taste, requirement and fact combination", () => {
    for (const taste of TASTES) {
      for (const requirements of REQUIREMENT_SETS) {
        for (const arabicaPercent of [null, 0, 100]) {
          for (const roast of [null, "светло", "тъмно"]) {
            const pool = legacyPool((i) => ({
              arabicaPercent: i % 2 ? arabicaPercent : null,
              roast: i % 3 ? roast : null,
            }));
            const answers = answersOf({ taste, requirements });
            const result = scoreRecommendations(answers, pool, { limit: 12 });

            const wantsDecaf = requirements.includes("decaf");
            const relaxedKeys = result.relaxed.map((r) => r.key);
            for (const { product } of result.picks) {
              const isDecaf = product.attributes.decaf === "yes";
              if (!relaxedKeys.includes("decaf")) expect(isDecaf).toBe(wantsDecaf);
              if (requirements.includes("flavoured") && !relaxedKeys.includes("flavoured")) {
                expect(product.attributes.aromas).toBe("yes");
              }
              if (requirements.includes("plain") && !relaxedKeys.includes("plain")) {
                expect(product.attributes.aromas).not.toBe("yes");
              }
            }
            expect(result.picks.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("still say so out loud when a rule has to be relaxed", () => {
    const result = scoreRecommendations(answersOf({ taste: "mild", requirements: ["decaf"] }), [
      candidate({ name: "Единственото", brand: "a", strength: "weak", ...BEST }),
    ]);
    expect(result.relaxed.map((entry) => entry.key)).toEqual(["decaf"]);
    expect(result.picks[0]?.caveat).toBe("Съдържа кофеин");
  });
});

/* --- 7. Determinism ------------------------------------------------------ */

describe("determinism", () => {
  const facts = (i: number): Partial<Overrides> => ({
    arabicaPercent: [100, 100, 60, null, 85][i % 5],
    roast: ["светло", "светло", "тъмно", null, "средно"][i % 5],
  });

  it("gives the same result for the same input, and for the same pool in any order", () => {
    const pool = legacyPool(facts);
    for (const answers of allAnswerSets().filter((_, index) => index % 7 === 0)) {
      const first = scoreRecommendations(answers, pool);
      expect(scoreRecommendations(answers, pool)).toEqual(first);
      const reversed = scoreRecommendations(answers, [...pool].reverse());
      expect(reversed.picks.map((e) => e.product.slug)).toEqual(
        first.picks.map((e) => e.product.slug),
      );
      expect(reversed.alternative?.product.slug ?? null).toBe(
        first.alternative?.product.slug ?? null,
      );
    }
  });

  it("breaks ties between identical facts by name, not by input order", () => {
    const pool = ["Ц", "А", "Б"].map((name, index) =>
      candidate({
        name,
        brand: `brand-${index}`,
        strength: "weak",
        arabicaPercent: 90,
        roast: "светло",
      }),
    );
    const answers = answersOf({ taste: "mild" });
    const order = (list: RecommendationCandidate[]) =>
      scoreRecommendations(answers, list).picks.map((e) => e.product.name);
    expect(order(pool)).toEqual(["А", "Б", "Ц"]);
    expect(order([...pool].reverse())).toEqual(["А", "Б", "Ц"]);
  });

  it("does not depend on the clock", () => {
    const pool = legacyPool(facts);
    const answers = answersOf({ taste: "intense", volume: "regular", budget: "cheap" });
    const before = scoreRecommendations(answers, pool);
    const realNow = Date.now;
    try {
      Date.now = () => 0;
      expect(scoreRecommendations(answers, pool)).toEqual(before);
    } finally {
      Date.now = realNow;
    }
  });
});

/* --- The table that justifies the leanings ------------------------------- */

describe("taste leanings", () => {
  it("covers every taste option, and the classic option leans on nothing", () => {
    expect(Object.keys(TASTE_LEANING).sort()).toEqual([...TASTES].sort());
    expect(TASTE_LEANING.classic).toEqual({ arabica: 0, darkness: 0 });
  });

  it("has a requirement list that no fact consults", () => {
    // Decaf, flavoured and plain are hard rules; no fact is evidence for or against them.
    expect(REQUIREMENT_OPTIONS.map((o) => o.value)).toEqual(["decaf", "flavoured", "plain"]);
  });
});
