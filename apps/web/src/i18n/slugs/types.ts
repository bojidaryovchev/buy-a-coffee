/**
 * The shape of a locale's slug table.
 *
 * **Canonical segments are the folder names under `src/app/(site)/[lang]/`**,
 * which are the Bulgarian slugs the shop launched with. A route constant in
 * `lib/routes.ts` and the directory it resolves to are therefore the same
 * string, and nothing has to know about translation except the two edges:
 * `href()` translates canonical segments into the visitor's language on the way
 * out, and `proxy.ts` translates them back on the way in.
 *
 * A nested static segment is keyed by its full canonical path —
 * `izbor-na-kafe/rezultat`, not `rezultat` — because a segment is only a route
 * segment under its own parent. `rezultat` under `marki/` would be a brand
 * slug, and must not be translated.
 *
 * The keys are listed once, here, so a slug table that forgets one is a type
 * error, not an untranslated URL.
 */
export const ROUTE_SEGMENTS = [
  "kategorii",
  "marki",
  "tarsene",
  "promotsii",
  "kafe-za-vending-mashini",
  "konsumativi",
  "dostavka-i-plashtane",
  "kontakti",
  "poveritelnost",
  "obshti-usloviya",
  "biskvitki",
  "blog",
  "izbor-na-kafe",
  "izbor-na-kafe/rezultat",
  "za-kafemashina",
  "byuletin",
  "byuletin/otpisvane",
] as const;

export type RouteSegment = (typeof ROUTE_SEGMENTS)[number];

export interface LocaleSlugs {
  /** Canonical segment → the segment this locale publishes. */
  readonly segments: Readonly<Record<RouteSegment, string>>;
  /**
   * A category's source key → its landing slug in this locale.
   *
   * Keyed by source key, not by our stored slug: the stored slug is frozen at
   * whatever the category was first called (`kapsuli`), while the landing slug
   * carries the search term the page is meant to rank for (`kafe-kapsuli`). A
   * category the sync adds tomorrow is not in this table and is served at its
   * stored slug until someone gives it one.
   */
  readonly categories: Readonly<Record<string, string>>;
  /**
   * A brand's source key → the slug its page is published at in this locale,
   * for the brands whose stored slug is not how the brand writes itself.
   *
   * The stored slug is derived from the supplier's label for the brand
   * (`LOLLOCAFE` → `lollocafe`) and frozen; the brand calls itself Lollo
   * Caffè. A brand with no entry is served at its stored slug, which for most
   * of them is already right. The stored slug of a brand that has an entry
   * answers 308 to the one here (`brandSlug` in `lib/routes.ts`).
   */
  readonly brands: Readonly<Record<string, string>>;
}
