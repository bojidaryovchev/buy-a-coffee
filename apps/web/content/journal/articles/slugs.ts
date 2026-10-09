/**
 * Slugs of the articles that link to each other in both directions.
 *
 * An article's slug normally lives in its own file, beside the text it names.
 * The beans article and the arabica article each send the reader to the other,
 * and two files importing a constant from each other is a cycle; so these two
 * slugs live here, and each article re-exports its own.
 */
export const CHOOSE_BEANS_SLUG = "kak-da-izberete-kafe-na-zarna";
export const ARABICA_ROBUSTA_SLUG = "arabika-i-robusta";
