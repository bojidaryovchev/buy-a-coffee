import { or, sql, type SQL } from "drizzle-orm";
import { brands, categories, products } from "@catalog/db/schema";

/**
 * The search predicate, defined once.
 *
 * Listing results, facet counts and the typeahead all match with exactly this,
 * so the dropdown can never suggest a product the results page then fails to
 * show. Anything that changes how search matches changes it here.
 *
 * Both sides of every comparison are folded to Latin by `catalog_translit`
 * (see `0003_search_translit.sql`), which is what makes `rema` find „Рема“ and
 * „рема“ find „Rema“. Latin text folds to itself, so this costs nothing for the
 * half of the catalog that is already written in it.
 *
 * Every fragment below is parameterised. A search term is never spliced into
 * SQL as text.
 */

/**
 * Folded columns. These expressions must stay character-identical to the ones
 * in `0003_search_translit.sql`, or PostgreSQL will not recognise the
 * expression indexes and every search becomes a sequential scan.
 */
const foldedName = sql`catalog_translit(${products.name})`;
const foldedBrandName = sql`catalog_translit(${brands.name})`;
const foldedCategoryName = sql`catalog_translit(${categories.name})`;

/**
 * The generated tsvector column, itself built over folded text. Created by
 * `0003_search_translit.sql` rather than by the schema DSL, which cannot
 * express a generated column, so it is referenced by name.
 */
const searchVector = sql`products.search_vector`;

/** The folded search term, for full-text and trigram comparisons. */
function folded(term: string): SQL {
  return sql`catalog_translit(${term})`;
}

/**
 * A `LIKE` pattern is the one place a search term stops being opaque: `%` and
 * `_` are wildcards inside it. Escaping them keeps a search for "100%" a search
 * for that literal text rather than a request for every row in the table.
 */
function foldedPattern(term: string): SQL {
  return sql`catalog_translit(${term.replace(/[\\%_]/g, (character) => `\\${character}`)})`;
}

/** `column` contains the term, in either script. */
function contains(column: SQL, term: string): SQL {
  return sql`${column} like '%' || ${foldedPattern(term)} || '%' escape '\\'`;
}

/**
 * Products matching a search term.
 *
 * Three strategies, because no one of them covers what people actually type:
 *
 *  - Full text over the tsvector: whole words, ranked, and the only strategy
 *    that reaches the description and the SKU.
 *  - Substring: partial words ("lavaz", "капсул"), which full text cannot do.
 *  - Word similarity (`%>`): misspellings, which neither of the others can do.
 *    Not plain `similarity()`: that scores the term against the *whole* name,
 *    so "lavaza" against "Кафе на зърна Lavazza Crema E Aroma 1кг." lands at
 *    0.15 — below any threshold that also rejects nonsense. `%>` scores it
 *    against the best matching run of words instead, which puts that typo at
 *    0.71 while "zzzzqqqq" stays at 0.14. Its cut-off lives in
 *    `pg_trgm.word_similarity_threshold`, pinned to 0.6 by the migration,
 *    because a GUC is the form the trigram index can accelerate.
 *
 * All three are index-backed.
 */
export function searchMatchProductsOnly(term: string): SQL {
  return or(
    sql`${searchVector} @@ plainto_tsquery('simple', ${folded(term)})`,
    contains(foldedName, term),
    sql`${foldedName} %> ${folded(term)}`,
  ) as SQL;
}

/**
 * As `searchMatchProductsOnly`, plus a match on the brand name, so searching a
 * brand finds its whole range and not only the products that repeat the brand
 * in their own name. Requires the caller to have joined `brands`.
 */
export function searchMatch(term: string): SQL {
  return or(searchMatchProductsOnly(term), contains(foldedBrandName, term)) as SQL;
}

/** A brand whose name matches the term. Requires `brands` in the query. */
export function brandNameMatch(term: string): SQL {
  return contains(foldedBrandName, term);
}

/** A category whose name matches the term. Requires `categories` in the query. */
export function categoryNameMatch(term: string): SQL {
  return contains(foldedCategoryName, term);
}

/** Relevance ordering for a search term, best first. */
export function searchRank(term: string): SQL[] {
  return [
    sql`ts_rank(${searchVector}, plainto_tsquery('simple', ${folded(term)})) desc`,
    sql`word_similarity(${folded(term)}, ${foldedName}) desc`,
  ];
}

/**
 * Ordering for the typeahead, which answers a different question from the
 * results page: not "what is most relevant to this phrase" but "what am I
 * part-way through typing". A name that starts with the term is nearly always
 * the intended one, so that wins outright, then a name that contains it, and
 * only then the ranked signals.
 */
export function suggestionRank(term: string): SQL[] {
  const pattern = foldedPattern(term);
  return [
    sql`case
          when ${foldedName} like ${pattern} || '%' escape '\\' then 0
          when ${foldedName} like '%' || ${pattern} || '%' escape '\\' then 1
          else 2
        end asc`,
    sql`(${products.availability} = 'in_stock') desc`,
    ...searchRank(term),
  ];
}
