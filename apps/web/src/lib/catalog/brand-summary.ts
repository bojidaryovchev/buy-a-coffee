import { BREWING_SYSTEMS, type BrewingSystem } from "@/lib/recommend/systems";

/**
 * What we stock from a brand, said in a sentence.
 *
 * Computed from the catalog rather than written by hand, for two reasons. We
 * hold no sourced facts about the brands themselves — no founding year, no
 * roastery, no house style — so anything written about them would be invented.
 * And what we *do* know, which formats we carry, changes with every sync; a
 * sentence typed today would be wrong the day a system sells out.
 *
 * Pure: the page does the reading, this does the wording, and every
 * combination is covered by a test.
 */

export interface BrandSummary {
  /** One sentence naming the formats and systems in stock. */
  readonly sentence: string;
  /**
   * A second sentence about capsule compatibility, or null when the brand has
   * no capsules. Separate so the page can follow it with a link to the machine
   * finder.
   */
  readonly capsuleNote: string | null;
}

/**
 * The brewing systems a set of categories belongs to, in catalog order.
 *
 * Matched by slug or by source key — the same either-or rule the wizard's
 * queries use, so the brand page and the wizard cannot disagree about which
 * system a category is.
 */
export function systemsForCategories(
  categories: ReadonlyArray<{ readonly slug: string; readonly sourceKey?: string | null }>,
): readonly BrewingSystem[] {
  return BREWING_SYSTEMS.filter((system) =>
    categories.some(
      (category) =>
        system.categorySlugs.includes(category.slug) ||
        (category.sourceKey != null && system.categorySourceKeys.includes(category.sourceKey)),
    ),
  );
}

/** "A", "A и B", "A, B и C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/**
 * Compose the summary for a brand, or null when there is nothing to say.
 *
 * Beans and pods are named as formats; capsules are named by system, because
 * "капсули" alone does not tell anyone whether they fit. When a brand has both,
 * the capsules go last behind „както и", which keeps the list of systems from
 * running into the list of formats („зърна и капсули за A и B" reads as three
 * things or four, depending on the reader).
 */
export function composeBrandSummary(
  brandName: string,
  systems: readonly BrewingSystem[],
): BrandSummary | null {
  const formats: string[] = [];
  if (systems.some((system) => system.method === "beans")) formats.push("кафе на зърна");
  if (systems.some((system) => system.method === "pod")) formats.push("хартиени дози ESE");

  const capsuleSystems = systems.filter((system) => system.method === "capsule");
  const capsules =
    capsuleSystems.length > 0
      ? `капсули за ${joinList(capsuleSystems.map((system) => system.name))}`
      : null;

  if (formats.length === 0 && capsules === null) return null;

  const stocked =
    capsules === null
      ? joinList(formats)
      : formats.length === 0
        ? capsules
        : `${joinList(formats)}, както и ${capsules}`;

  const capsuleNote =
    capsuleSystems.length === 0
      ? null
      : capsuleSystems.length === 1
        ? "Капсулите са за тази система и не пасват на машини от друга."
        : "Капсулите от различните системи не са взаимозаменяеми — изберете тези за вашата машина.";

  return { sentence: `От ${brandName} предлагаме ${stocked}.`, capsuleNote };
}
