import { describe, expect, it } from "vitest";
import {
  SHORT_CIRCUIT_THRESHOLD,
  currentStep,
  parseWizardAnswers,
  wizardHref,
  withoutAnswer,
  type WizardAnswers,
} from "@/lib/recommend/answers";
import { scoreRecommendations, type RecommendationCandidate } from "@/lib/recommend/score";
import {
  BREWING_SYSTEMS,
  UNSUPPORTED_SYSTEMS,
  getBrewingSystem,
  isSupportedSystem,
  systemsForMethod,
} from "@/lib/recommend/systems";
import { MACHINE_BRANDS, allMachineModels, getMachineModel } from "@/content/machines";
import { parseIntensity } from "@/lib/catalog/attributes";

/* --- Fixtures ----------------------------------------------------------- */

let sequence = 0;

function candidate(overrides: {
  name?: string;
  brand?: string;
  strength?: string;
  intensity?: string;
  decaf?: "yes" | "no";
  aromas?: "yes" | "no";
  servings?: number | null;
  pricePerServing?: string | null;
}): RecommendationCandidate {
  sequence += 1;
  const slug = (overrides.name ?? `product-${sequence}`).toLowerCase().replace(/\s+/g, "-");
  const brand = overrides.brand ?? `brand-${sequence}`;

  return {
    id: `id-${sequence}`,
    slug,
    name: overrides.name ?? `Продукт ${sequence}`,
    price: { amount: "10.00", currency: "EUR", formatted: "10,00 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1кг.",
    intensity: overrides.intensity ?? null,
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

/* --- Answer parsing ----------------------------------------------------- */

describe("parseWizardAnswers", () => {
  it("reads a complete set of answers", () => {
    const answers = parseWizardAnswers({
      brew: "capsule",
      system: "nespresso-original",
      taste: "intense",
      volume: "heavy",
      budget: "cheap",
      requirements: "decaf",
    });
    expect(answers.system).toBe("nespresso-original");
    expect(answers.taste).toBe("intense");
    expect(answers.requirements).toEqual(["decaf"]);
  });

  it("drops unknown values instead of failing", () => {
    const answers = parseWizardAnswers({
      brew: "telepathy",
      system: "not-a-system",
      taste: "; drop table products",
      requirements: "decaf,nonsense",
    });
    expect(answers.brew).toBeNull();
    expect(answers.system).toBeNull();
    expect(answers.taste).toBeNull();
    expect(answers.requirements).toEqual(["decaf"]);
  });

  it("derives the brew method from the system", () => {
    // Arriving from a machine page answers step one without showing it.
    const answers = parseWizardAnswers({ system: "beans" });
    expect(answers.brew).toBe("beans");
  });

  it("drops both halves of a contradiction rather than picking a winner", () => {
    const answers = parseWizardAnswers({ requirements: "flavoured,plain" });
    expect(answers.requirements).toEqual([]);
  });

  it("rejects a machine slug that is not slug-shaped", () => {
    expect(parseWizardAnswers({ machine: "../../etc/passwd" }).machine).toBeNull();
    expect(parseWizardAnswers({ machine: "krups-genio-s" }).machine).toBe("krups-genio-s");
  });
});

describe("wizardHref", () => {
  it("omits everything unanswered", () => {
    expect(wizardHref({})).toBe("/wizard");
    expect(wizardHref({ system: "beans" })).toBe("/wizard?system=beans");
  });

  it("round-trips through the parser", () => {
    const original = answersOf({
      taste: "mild",
      volume: "light",
      budget: "any",
      requirements: ["decaf"],
    });
    const href = wizardHref(original);
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));
    expect(parseWizardAnswers(params)).toEqual(original);
  });

  it("targets another base path when asked", () => {
    expect(wizardHref({ system: "beans" }, "/wizard/result")).toBe("/wizard/result?system=beans");
  });
});

describe("currentStep", () => {
  it("walks the questions in order", () => {
    const empty = answersOf({ brew: null, system: null });
    expect(currentStep(empty, { candidateCount: null })).toBe("brew");
    expect(currentStep(answersOf({ system: null }), { candidateCount: null })).toBe("system");
    expect(currentStep(answersOf({}), { candidateCount: 40 })).toBe("taste");
    expect(currentStep(answersOf({ taste: "mild" }), { candidateCount: 40 })).toBe("volume");
    expect(currentStep(answersOf({ taste: "mild", volume: "light" }), { candidateCount: 40 })).toBe(
      "preferences",
    );
    expect(
      currentStep(answersOf({ taste: "mild", volume: "light", budget: "any" }), {
        candidateCount: 40,
      }),
    ).toBe("result");
  });

  it("skips the questions when there is almost nothing to narrow", () => {
    // Three systems in this catalog hold three products each.
    const answers = answersOf({});
    expect(currentStep(answers, { candidateCount: SHORT_CIRCUIT_THRESHOLD })).toBe("result");
    expect(currentStep(answers, { candidateCount: SHORT_CIRCUIT_THRESHOLD + 1 })).toBe("taste");
  });
});

describe("withoutAnswer", () => {
  it("clears one answer and leaves the rest", () => {
    const answers = answersOf({ taste: "mild", volume: "light" });
    expect(withoutAnswer(answers, "taste").taste).toBeNull();
    expect(withoutAnswer(answers, "taste").volume).toBe("light");
    expect(withoutAnswer(answers, "requirements").requirements).toEqual([]);
  });
});

/* --- Intensity ---------------------------------------------------------- */

describe("parseIntensity", () => {
  it("reads every scale the source uses", () => {
    expect(parseIntensity("8 от 12")).toEqual({ value: 8, max: 12, fraction: 8 / 12 });
    expect(parseIntensity("4 от 5")).toEqual({ value: 4, max: 5, fraction: 0.8 });
    expect(parseIntensity("13 от 13")).toEqual({ value: 13, max: 13, fraction: 1 });
  });

  it("compares across scales by fraction, not by numeral", () => {
    // An 8 is near the top of one scale and the middle of another.
    const outOfTen = parseIntensity("8 от 10")!;
    const outOfThirteen = parseIntensity("8 от 13")!;
    expect(outOfTen.fraction).toBeGreaterThan(outOfThirteen.fraction);
  });

  it("returns null for anything that does not parse", () => {
    expect(parseIntensity(null)).toBeNull();
    expect(parseIntensity("силно")).toBeNull();
    expect(parseIntensity("14 от 12")).toBeNull();
    expect(parseIntensity("8 от 0")).toBeNull();
  });
});

/* --- Brewing systems ---------------------------------------------------- */

describe("brewing systems", () => {
  it("has a unique id per system", () => {
    const ids = BREWING_SYSTEMS.map((system) => system.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("binds every system to at least one category slug and source key", () => {
    for (const system of BREWING_SYSTEMS) {
      expect(system.categorySlugs.length).toBeGreaterThan(0);
      expect(system.categorySourceKeys.length).toBeGreaterThan(0);
    }
  });

  it("has exactly one system for beans and for pods, so those steps are skipped", () => {
    expect(systemsForMethod("beans")).toHaveLength(1);
    expect(systemsForMethod("pod")).toHaveLength(1);
    expect(systemsForMethod("capsule").length).toBeGreaterThan(1);
  });

  it("keeps supported and unsupported systems disjoint", () => {
    for (const system of UNSUPPORTED_SYSTEMS) {
      expect(getBrewingSystem(system.id)).toBeNull();
      expect(isSupportedSystem(system.id)).toBe(false);
    }
  });

  it("explains every unsupported system rather than just naming it", () => {
    for (const system of UNSUPPORTED_SYSTEMS) {
      expect(system.explanation.length).toBeGreaterThan(40);
    }
  });
});

/* --- Machine database --------------------------------------------------- */

describe("machine database", () => {
  it("has unique brand and model slugs", () => {
    const brandSlugs = MACHINE_BRANDS.map((brand) => brand.slug);
    expect(new Set(brandSlugs).size).toBe(brandSlugs.length);

    const modelSlugs = allMachineModels().map(({ model }) => model.slug);
    expect(new Set(modelSlugs).size).toBe(modelSlugs.length);
  });

  it("points every model at a system that exists", () => {
    /*
     * The one integrity rule that matters: a model pointing at a system id
     * nobody defines would send a visitor to a page that silently offers them
     * nothing, and nothing else in the build would notice.
     */
    for (const { brand, model } of allMachineModels()) {
      const known =
        getBrewingSystem(model.system) !== null ||
        UNSUPPORTED_SYSTEMS.some((system) => system.id === model.system);
      expect(known, `${brand.name} ${model.name} -> ${model.system}`).toBe(true);
    }
  });

  it("uses url-safe slugs, since they are route segments", () => {
    for (const brand of MACHINE_BRANDS) {
      expect(brand.slug).toMatch(/^[a-z0-9-]+$/);
      for (const model of brand.models) expect(model.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("covers every stocked system with at least one machine", () => {
    // A system nobody can reach through the finder is a dead end in the data.
    for (const system of BREWING_SYSTEMS) {
      const covered = allMachineModels().some(({ model }) => model.system === system.id);
      expect(covered, system.id).toBe(true);
    }
  });

  it("keeps the incompatible machines listed, not hidden", () => {
    // Someone with a Vertuo must reach a straight answer.
    const vertuo = getMachineModel("nespresso-vertuo");
    expect(vertuo?.model.system).toBe("nespresso-vertuo");
    expect(isSupportedSystem(vertuo!.model.system)).toBe(false);
  });

  it("marks cross-format compatibility rather than implying endorsement", () => {
    const cafissimo = getMachineModel("tchibo-cafissimo-classic");
    expect(cafissimo?.model.system).toBe("caffitaly");
    expect(cafissimo?.model.crossFormat).toBe(true);
  });
});

/* --- Scoring ------------------------------------------------------------ */

describe("scoreRecommendations", () => {
  it("ranks the matching strength first", () => {
    const result = scoreRecommendations(answersOf({ taste: "intense" }), [
      candidate({ name: "Меко", brand: "a", strength: "weak" }),
      candidate({ name: "Средно", brand: "b", strength: "medium" }),
      candidate({ name: "Силно", brand: "c", strength: "strong" }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Силно");
  });

  it("prefers the closest intensity within the same strength", () => {
    const result = scoreRecommendations(answersOf({ taste: "classic" }), [
      candidate({ name: "Ниска", brand: "a", strength: "medium", intensity: "2 от 12" }),
      candidate({ name: "Средна", brand: "b", strength: "medium", intensity: "7 от 12" }),
      candidate({ name: "Висока", brand: "c", strength: "medium", intensity: "12 от 12" }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Средна");
  });

  it("excludes decaf when nobody asked for it", () => {
    const result = scoreRecommendations(answersOf({ taste: "intense" }), [
      candidate({ name: "Без кофеин", brand: "a", strength: "strong", decaf: "yes" }),
      candidate({ name: "С кофеин", brand: "b", strength: "strong" }),
    ]);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]?.product.name).toBe("С кофеин");
    // An unrequested default is not worth telling the visitor about.
    expect(result.relaxed).toEqual([]);
  });

  it("warns when decaf is all there is and nobody asked for it", () => {
    /*
     * One system in this catalog holds exactly one product and it is
     * decaffeinated. Showing it is right — an empty page helps nobody — but
     * showing it silently would let someone buy caffeine-free coffee after
     * answering "strong and intense".
     */
    const result = scoreRecommendations(answersOf({ taste: "intense" }), [
      candidate({ name: "Само без кофеин", brand: "a", strength: "strong", decaf: "yes" }),
    ]);
    expect(result.picks).toHaveLength(1);
    expect(result.relaxed.map((entry) => entry.key)).toEqual(["decaf"]);
    expect(result.picks[0]?.caveat).toBe("Без кофеин");
  });

  it("returns only decaf when decaf is required", () => {
    const result = scoreRecommendations(answersOf({ requirements: ["decaf"] }), [
      candidate({ name: "Без кофеин", brand: "a", decaf: "yes" }),
      candidate({ name: "С кофеин", brand: "b" }),
    ]);
    expect(result.picks.map((entry) => entry.product.name)).toEqual(["Без кофеин"]);
    expect(result.picks[0]?.caveat).toBeNull();
  });

  it("says so out loud when it cannot honour a decaf request", () => {
    const result = scoreRecommendations(answersOf({ requirements: ["decaf"] }), [
      candidate({ name: "С кофеин", brand: "a" }),
    ]);
    expect(result.picks).toHaveLength(1);
    expect(result.relaxed.map((entry) => entry.key)).toEqual(["decaf"]);
    expect(result.relaxed[0]?.message).toMatch(/без кофеин/i);
    // And the card itself carries the warning, not just the page.
    expect(result.picks[0]?.caveat).toBe("Съдържа кофеин");
  });

  it("never returns an empty result when candidates exist", () => {
    const result = scoreRecommendations(
      answersOf({ requirements: ["decaf", "flavoured"], taste: "intense", volume: "heavy" }),
      [candidate({ name: "Единственото", brand: "a" })],
    );
    expect(result.picks).toHaveLength(1);
    expect(result.relaxed.length).toBeGreaterThan(0);
  });

  it("pushes flavoured coffee down when nobody asked for it", () => {
    const result = scoreRecommendations(answersOf({ taste: "classic" }), [
      candidate({ name: "Ароматизирано", brand: "a", strength: "medium", aromas: "yes" }),
      candidate({ name: "Обикновено", brand: "b", strength: "medium" }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Обикновено");
  });

  it("prefers a pack that fits how much gets drunk", () => {
    const result = scoreRecommendations(answersOf({ volume: "light" }), [
      candidate({ name: "Голяма", brand: "a", servings: 400 }),
      candidate({ name: "Малка", brand: "b", servings: 60 }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Малка");
  });

  it("weighs price per cup when price is what matters", () => {
    const cheap = candidate({ name: "Изгодно", brand: "a", pricePerServing: "0.1000" });
    const dear = candidate({ name: "Скъпо", brand: "b", pricePerServing: "0.5000" });

    const priceLed = scoreRecommendations(answersOf({ budget: "cheap" }), [dear, cheap]);
    expect(priceLed.picks[0]?.product.name).toBe("Изгодно");
    expect(priceLed.picks[0]?.reasons).toContain("едно от най-изгодните на чаша");

    // With price set aside, it is no longer the deciding factor.
    const priceIgnored = scoreRecommendations(answersOf({ budget: "any" }), [dear, cheap]);
    expect(priceIgnored.picks[0]?.score).toBe(priceIgnored.picks[1]?.score);
  });

  it("scores price against the pool's own range, not a fixed threshold", () => {
    /*
     * Beans run about EUR 0.09-0.16 a cup and capsules EUR 0.25-0.54. A fixed
     * "cheap" ceiling would empty one of the two systems; a relative one finds
     * the cheapest of whatever is actually compatible.
     */
    const result = scoreRecommendations(answersOf({ budget: "cheap" }), [
      candidate({ name: "Скъпа капсула", brand: "a", pricePerServing: "0.5300" }),
      candidate({ name: "Евтина капсула", brand: "b", pricePerServing: "0.2600" }),
    ]);
    expect(result.picks[0]?.product.name).toBe("Евтина капсула");
    expect(result.picks[0]?.reasons).toContain("едно от най-изгодните на чаша");
  });

  it("does not offer three versions of the same brand", () => {
    const result = scoreRecommendations(answersOf({ taste: "intense" }), [
      candidate({ name: "Rema 1", brand: "rema", strength: "strong" }),
      candidate({ name: "Rema 2", brand: "rema", strength: "strong" }),
      candidate({ name: "Rema 3", brand: "rema", strength: "strong" }),
      candidate({ name: "Lavazza", brand: "lavazza", strength: "strong" }),
      candidate({ name: "Borbone", brand: "borbone", strength: "strong" }),
    ]);
    const brands = result.picks.map((entry) => entry.product.brand?.slug);
    expect(new Set(brands).size).toBe(brands.length);
  });

  it("fills the last slots from a repeated brand rather than returning fewer", () => {
    const result = scoreRecommendations(answersOf({}), [
      candidate({ name: "A1", brand: "a" }),
      candidate({ name: "A2", brand: "a" }),
      candidate({ name: "B1", brand: "b" }),
    ]);
    expect(result.picks).toHaveLength(3);
  });

  it("gives every pick a reason when there was an answer to match", () => {
    const result = scoreRecommendations(
      answersOf({ taste: "intense", volume: "regular", budget: "cheap" }),
      [
        candidate({
          name: "Силно",
          brand: "a",
          strength: "strong",
          intensity: "11 от 12",
          servings: 120,
        }),
        candidate({ name: "Друго", brand: "b", strength: "strong", servings: 100 }),
      ],
    );
    expect(result.picks[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("is deterministic, including in a tie", () => {
    const pool = [
      candidate({ name: "Едно", brand: "a" }),
      candidate({ name: "Две", brand: "b" }),
      candidate({ name: "Три", brand: "c" }),
    ];
    const first = scoreRecommendations(answersOf({ taste: "classic" }), pool);
    const second = scoreRecommendations(answersOf({ taste: "classic" }), [...pool].reverse());
    expect(first.picks.map((entry) => entry.product.slug)).toEqual(
      second.picks.map((entry) => entry.product.slug),
    );
  });

  it("offers an alternative that is genuinely different, or none", () => {
    const result = scoreRecommendations(answersOf({ taste: "classic" }), [
      candidate({ name: "M1", brand: "a", strength: "medium" }),
      candidate({ name: "M2", brand: "b", strength: "medium" }),
      candidate({ name: "M3", brand: "c", strength: "medium" }),
      candidate({ name: "S1", brand: "d", strength: "strong" }),
    ]);
    expect(result.alternative?.product.name).toBe("S1");

    const noRoom = scoreRecommendations(answersOf({ taste: "classic" }), [
      candidate({ name: "Само", brand: "a", strength: "medium" }),
    ]);
    expect(noRoom.alternative).toBeNull();
  });

  it("handles an empty catalog without throwing", () => {
    const result = scoreRecommendations(answersOf({ taste: "intense" }), []);
    expect(result.picks).toEqual([]);
    expect(result.alternative).toBeNull();
    expect(result.eligibleCount).toBe(0);
  });
});
