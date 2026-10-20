import "server-only";
import { cache } from "react";
import { brandFactsFor } from "../../../content/brand-facts";
import { brandDisplayName } from "./brand-display";
import {
  ITALIAN_SECTION_MIN,
  selectBeansSections,
  type BeansSectionRow,
  type BeansSections,
} from "./beans-sections";
import { unitPriceView } from "./format";
import { loadLandingRows } from "./landing-queries";
import type { LandingRow } from "./landings";
import { listProductCardsByIds } from "./queries";
import type { ProductCardView } from "./types";

/**
 * The read behind the beans listing's sections by use.
 *
 * The rows are the landings' (`loadLandingRows`): every product on sale, read
 * once per request and already read on this page for its cross-links, so the
 * sections cost no catalog read of their own beyond the cards of the dozen
 * packs at most that the Italian section lists — without their photographs,
 * which the section does not draw. The facts the rules need are resolved here,
 * each from the one place it is decided:
 *
 *  - Italian: `brandFactsFor`, the record with the evidence for each brand,
 *    looked up by the brand's stored slug exactly as the brand index's
 *    sentence about Italian brands looks it up (`brandsIndexIntro`).
 *  - the brand's name, for the order: `brandDisplayName`, by the brand's
 *    source key. Every brand recorded as Italian has its spelling in
 *    `brand-names.ts` (`test/listing-meta.test.ts`), so the key is enough.
 */

/** One product in a section, ready to draw: its card, and its price for a kilogram. */
export interface BeansSectionEntry {
  readonly card: ProductCardView;
  /** „16,50 € / кг“, from the card's own price and the pack's weight. */
  readonly perKilogram: string | null;
}

export interface BeansSectionsView {
  /** One pack per Italian brand, by brand name; null when the section is not shown. */
  readonly italian: readonly BeansSectionEntry[] | null;
  readonly automatic: BeansSections["automatic"];
}

/** A row with the facts resolved. */
export function withSectionFacts(row: LandingRow): BeansSectionRow {
  const key = row.brandSourceKey ?? row.brandSlug;
  return {
    ...row,
    italianBrand:
      row.brandSlug !== null && brandFactsFor({ slug: row.brandSlug }).italian !== undefined,
    brandName: key === null ? null : brandDisplayName({ name: key, sourceKey: row.brandSourceKey }),
  };
}

/**
 * The sections, each with what it draws.
 *
 * A product that left the catalog between the two reads has no card and is
 * dropped; the Italian section is dropped with it if that leaves it below its
 * minimum, so the heading never stands over fewer brands than the rule allows.
 * Cached per request, like the landings.
 */
export const getBeansSections = cache(async (): Promise<BeansSectionsView> => {
  const rows = (await loadLandingRows()).map(withSectionFacts);
  const { italian, automatic } = selectBeansSections(rows);
  if (!italian) return { italian: null, automatic };

  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards = await listProductCardsByIds(
    italian.map((item) => item.id),
    { images: false },
  );

  const entries = italian.flatMap((item) => {
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
  });

  return { italian: entries.length >= ITALIAN_SECTION_MIN ? entries : null, automatic };
});
