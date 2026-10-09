/**
 * Addresses the seeded catalog's products are given on purpose as ones they
 * used to have.
 *
 * The end-to-end suite checks that a product's old address answers 308 to its
 * new one (`e2e/names.spec.ts`), and for that it needs an old address to ask
 * for. It used to get one by accident: the committed snapshot was exported
 * before products moved to the shop's own slugs, so the seed's reslug moved
 * every product and left the snapshot's slug in `previous_slugs`. The first
 * snapshot exported after the move carries the new slugs, the reslug moves
 * nothing, and the redirect test would have nothing left to redirect.
 *
 * So the seed writes these itself (`seedFormerSlugs` in `reference-seed.ts`),
 * after the reslug, whatever the snapshot's age: on today's snapshot each is
 * already there and nothing is written; on a later one each is added. The
 * spec reads the same list, so the two cannot drift.
 *
 * Each `former` is the slug the product really had before the move, and
 * `slug` is the one it has now — which is frozen, so it identifies the
 * product in any snapshot that still lists it. The seed fails loudly if one
 * of them is no longer there, rather than leave the redirect test asking for
 * an address nothing redirects.
 *
 * No imports, on purpose: a Playwright spec loads this file.
 */
export interface FormerSlug {
  /** The product's current slug. */
  readonly slug: string;
  /** A slug it used to have, which must answer 308 to `slug`. */
  readonly former: string;
}

export const SEEDED_FORMER_SLUGS = {
  /** One Dolce Gusto capsule, under the supplier's wording for it. */
  capsule: {
    slug: "borbone-crema-classica-kapsuli-dolce-gusto-16-br",
    former: "kapsuli-dg-borbone-crema-classica-16-br",
  },
  /** One bag of beans. */
  beans: {
    slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
    former: "kafe-na-zarna-lavazza-super-crema-1kg",
  },
  /** The two bags the supplier gives one name, which once shared a base slug. */
  cremaEAroma: {
    slug: "lavazza-crema-e-aroma-kafe-na-zarna-1-kg",
    former: "kafe-na-zarna-lavazza-crema-e-aroma-1kg-1000g",
  },
  cremaEAromaExpert: {
    slug: "lavazza-crema-e-aroma-expert-kafe-na-zarna-1-kg",
    former: "kafe-na-zarna-lavazza-crema-e-aroma-1kg",
  },
} as const satisfies Record<string, FormerSlug>;
