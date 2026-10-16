import { normalizeLabel, transliterate } from "./text.ts";

/**
 * What kind of coffee a product is, as far as a cup is concerned.
 *
 * Almost everything this shop sells is roasted coffee: beans, capsules and
 * ESE pods, each brewed by a machine. Instant coffee is the exception. It is
 * dissolved, not brewed, so it fits no capsule system and needs no machine,
 * and a cup takes a fraction of the coffee: divided at the beans' dose, a tin
 * of instant came out about four times too dear per cup.
 *
 * **Recognised by the product's own name, never by its category.** The
 * supplier names every instant coffee for what it is („Разтворимо кафе Ristora
 * Gold 0.200кг.“), and the same words are printed on the tin. Its category is
 * the supplier's navigation: today the instant tins are the only thing filed
 * under its vending section, and tomorrow that section may hold bean blends for
 * vending machines as well. A category rule would then call those blends
 * instant, and miss an instant coffee filed anywhere else.
 *
 * Pure and dependency-free, like everything in this package: the sync, the
 * storefront and the scripts all ask here, so none of them can disagree.
 */

export type ProductKind = "roasted" | "instant";

/**
 * „Разтворимо кафе“ or „инстантно кафе“, in either order, as whole words —
 * written over the transliterated, lower-cased name.
 *
 * Both are what Bulgarian calls instant coffee; the supplier writes the first.
 * The pattern is matched against `transliterate()` output here and against
 * `catalog_translit()` output in SQL, which is a character-for-character copy
 * of it (`packages/shared/test/text.test.ts`), so the storefront's queries can
 * use this very string and the two cannot drift. It is therefore written in
 * the dialect both engines share: lookarounds, non-capturing groups, `\s`.
 */
export const INSTANT_COFFEE_PATTERN =
  "(?<![a-z0-9])(?:(?:raztvorimo|instantno)\\s+kafe|kafe\\s+(?:raztvorimo|instantno))(?![a-z0-9])";

const INSTANT_COFFEE = new RegExp(INSTANT_COFFEE_PATTERN);

/** True when the supplier's name says the product is instant coffee. */
export function isInstantCoffeeName(sourceName: string | null | undefined): boolean {
  return INSTANT_COFFEE.test(transliterate(normalizeLabel(sourceName ?? "")));
}

/** The kind of a product, from the supplier's name for it. */
export function productKind(sourceName: string | null | undefined): ProductKind {
  return isInstantCoffeeName(sourceName) ? "instant" : "roasted";
}
