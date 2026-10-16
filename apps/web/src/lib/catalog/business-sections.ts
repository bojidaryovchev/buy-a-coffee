import { compareDecimal, packQuantityLabel, parseDecimal, productKind } from "@catalog/shared";
import { SECTION_CATEGORY_KEYS, routes } from "@/lib/routes";

/**
 * The two business sections, `/bg/kafe-za-vending-mashini` and
 * `/bg/konsumativi`.
 *
 * Constants only, and no database: the navigation, the sitemap, the home page
 * and their tests all need to know which sections exist, and none of them
 * should have to open a database to find out. The reads are in `vending.ts`.
 */

export type BusinessSectionId = "vending" | "consumables";

export interface BusinessSection {
  readonly id: BusinessSectionId;
  /** Canonical, from `lib/routes.ts`; `href()` gives it a locale. */
  readonly path: string;
  /**
   * The category that backs the section, by source key.
   *
   * The source key is the source's own slug and survives a rename of the
   * Bulgarian label; our storefront slug is derived from that label and would
   * not. Both are accepted, the same way the wizard binds a brewing system to
   * its categories, so either one changing costs us nothing.
   */
  readonly categoryKeys: readonly string[];
}

/**
 * What a section's own category holds, as far as its heading and description
 * need: how many products, how many of them instant coffee, and the pack sizes
 * the instant coffee comes in. Instant coffee is recognised by name
 * (`productKind`), never by the category, which is the source's navigation
 * and may hold bean blends tomorrow.
 */
export interface SectionContents {
  readonly products: number;
  readonly instant: number;
  /** „200 г“, „500 г“: the instant coffee's packs, smallest first, each once. */
  readonly instantPacks: readonly string[];
}

export function sectionContents(
  rows: ReadonlyArray<{
    readonly name: string;
    readonly weightValue: string | null;
    readonly weightUnit: string | null;
  }>,
): SectionContents {
  const instant = rows.filter((row) => productKind(row.name) === "instant");
  const packs = new Map<string, string>();
  for (const row of instant) {
    const label = packQuantityLabel(row.weightValue, row.weightUnit);
    if (label && row.weightValue) packs.set(label, row.weightValue);
  }
  const instantPacks = [...packs.entries()]
    .sort(([, a], [, b]) => compareDecimal(parseDecimal(a), parseDecimal(b)))
    .map(([label]) => label);
  return { products: rows.length, instant: instant.length, instantPacks };
}

export const BUSINESS_SECTIONS: Readonly<Record<BusinessSectionId, BusinessSection>> = {
  vending: { id: "vending", path: routes.vending, categoryKeys: SECTION_CATEGORY_KEYS.vending },
  consumables: {
    id: "consumables",
    path: routes.consumables,
    categoryKeys: SECTION_CATEGORY_KEYS.consumables,
  },
};
