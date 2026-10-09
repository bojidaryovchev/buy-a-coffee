/**
 * Product names the parser cannot get right from the catalog alone.
 *
 * A product's name on the storefront is built by `productName()` in
 * `@catalog/shared` from what the catalog holds: the brand, the brewing system
 * its category names, the parsed pack size, and what is left of the supplier's
 * name once those are taken out (the line: "Super Crema", "Oro"). That works
 * for nearly every product. This file is for the few where it does not.
 *
 * **Keyed by source key, not by our slug.** The slug is derived from the name
 * (`<brand>-<line>-<format>-<qty>`), and the sync allocates it the moment a
 * product is first seen, so an override has to be findable before a slug
 * exists; the source key is the one identity a product has at that point. It
 * is also the identity the sync keeps stable: a product the supplier moves to
 * another address keeps its row, and `productName()` looks an override up by
 * the keys the product answered to before as well as the current one.
 *
 * **Read by the sync too**, through `@catalog/shared/storefront-data`, which
 * is why this is plain data with no imports. A change here does not move an
 * existing product's URL: slugs are allocated once and frozen. To move one on
 * purpose, run `pnpm --filter @catalog/web catalog:reslug` (plan first), which
 * leaves the old slug answering 308.
 *
 * Every entry says why it exists. An entry whose source key no longer matches
 * a product fails `packages/shared/test/product-name.test.ts` once the fixture
 * is refreshed, so a stale override cannot linger unnoticed.
 */
export interface ProductNameOverride {
  /** The line as the brand writes it, replacing the parsed one. */
  readonly line?: string;
  /**
   * The pack size, replacing the parsed one. Only for a product whose stored
   * pack size is known to be wrong at the source.
   */
  readonly pack?: { readonly value: number; readonly unit: "g" | "ml" | "pc" };
}

export const productNameOverrides: Readonly<Record<string, ProductNameOverride>> = {
  /*
   * The supplier lists two different coffees under one name, "Кафе на зърна
   * Lavazza Crema E Aroma 1кг.". This one is the bag from Lavazza's Expert
   * range for professional machines: the pack is black with the "expert"
   * plate above "Crema & Aroma" and an intensity of 11/13, the supplier's own
   * address for it is `/lavazza-crema-aroma-expert-1/`, and its description
   * opens "Lavazza Expert Crema e Aroma". The other
   * (`/lavazza-crema-aroma-1/`, the gold retail bag, 8/10) is the plain
   * "Crema e Aroma" and needs no entry. "Expert" goes last so the name still
   * opens with the line people search for.
   */
  "/lavazza-crema-aroma-expert-1/#1000g": { line: "Crema e Aroma Expert" },

  /*
   * The supplier's pack-size field says "100 бр." for this tin; its name
   * ("…Decaffeinato 18бр."), its address (`/illy-decaffeinato-18/`) and its
   * price (the same 9,20 € as the 18-pod illy Classico tin) all say 18. The
   * name and the URL are frozen once published, so they carry the true count.
   */
  "/illy-decaffeinato-18/#100pc": { pack: { value: 18, unit: "pc" } },
};
