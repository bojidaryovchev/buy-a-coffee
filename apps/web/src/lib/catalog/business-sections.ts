/**
 * The two business sections, `/vending` and `/consumables`.
 *
 * Constants only, and no imports: the navigation, the sitemap, the home page
 * and their tests all need to know which sections exist, and none of them
 * should have to open a database to find out. The reads are in `vending.ts`.
 */

export type BusinessSectionId = "vending" | "consumables";

export interface BusinessSection {
  readonly id: BusinessSectionId;
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

export const BUSINESS_SECTIONS: Readonly<Record<BusinessSectionId, BusinessSection>> = {
  vending: { id: "vending", path: "/vending", categoryKeys: ["vending-zona"] },
  consumables: { id: "consumables", path: "/consumables", categoryKeys: ["konsumativi"] },
};
