import "server-only";
import { cache } from "react";
import { brandFactsFor } from "../../../content/brand-facts";
import {
  BEANS_SECTION_MIN,
  selectBeansSections,
  type BeansSectionId,
  type BeansSectionRow,
} from "./beans-sections";
import { unitPriceView } from "./format";
import { loadLandingRows } from "./landing-queries";
import type { LandingRow } from "./landings";
import { listProductCardsByIds } from "./queries";
import type { ProductCardView } from "./types";
import { isVendingBlendName } from "./vending";

/**
 * The read behind the beans listing's sections by use.
 *
 * The rows are the landings' (`loadLandingRows`): every product on sale, read
 * once per request and already read on this page for its cross-links, so the
 * sections cost no catalog read of their own beyond the cards of the dozen
 * products at most that they choose. The two facts the rules need are resolved
 * here, each from the one place it is decided:
 *
 *  - Italian: `brandFactsFor`, the record with the evidence for each brand,
 *    looked up by the brand's stored slug exactly as the brand index's
 *    sentence about Italian brands looks it up (`brandsIndexIntro`).
 *  - designated for machines: `isVendingBlendName`, the rule the vending
 *    page lists its blends by.
 */

/** One product in a section, ready to draw: its card, and its price for a kilogram. */
export interface BeansSectionEntry {
  readonly card: ProductCardView;
  /** „16,50 € / кг“, from the card's own price and the pack's weight. */
  readonly perKilogram: string | null;
}

export interface BeansSectionView {
  readonly id: BeansSectionId;
  readonly products: readonly BeansSectionEntry[];
}

/** A row with the two facts resolved. */
export function withSectionFacts(row: LandingRow): BeansSectionRow {
  return {
    ...row,
    italianBrand:
      row.brandSlug !== null && brandFactsFor({ slug: row.brandSlug }).italian !== undefined,
    machineBlend: isVendingBlendName(row.name),
  };
}

/**
 * The sections, in page order, each with the cards it draws.
 *
 * A product that left the catalog between the two reads has no card and is
 * dropped; a section that falls below the minimum on that account is dropped
 * with it, so a heading never stands over fewer products than the rule allows.
 * Cached per request, like the landings.
 */
export const getBeansSections = cache(async (): Promise<readonly BeansSectionView[]> => {
  const rows = (await loadLandingRows()).map(withSectionFacts);
  const sections = selectBeansSections(rows);
  if (sections.length === 0) return [];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards = await listProductCardsByIds(
    sections.flatMap((section) => section.items.map((item) => item.id)),
  );

  return sections
    .map((section) => ({
      id: section.id,
      products: section.items.flatMap((item) => {
        const card = cards.get(item.id);
        const row = byId.get(item.id);
        if (!card || !row) return [];
        const perKilogram = unitPriceView(
          card.price?.amount,
          row.weightValue,
          row.weightUnit,
          card.price?.currency,
        );
        return [{ card, perKilogram: perKilogram?.formatted ?? null }];
      }),
    }))
    .filter((section) => section.products.length >= BEANS_SECTION_MIN);
});
