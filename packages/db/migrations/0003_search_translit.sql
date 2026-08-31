-- Script-agnostic search.
--
-- The catalog is Bulgarian but half of it is not: product names read
-- "Капсули Nespresso Rema Caffè Cookies" — a Cyrillic noun, a Latin brand.
-- People type whichever script is under their fingers, so `rema` has to find
-- "Рема" and `рема` has to find "Rema". Matching the two scripts against each
-- other pairwise does not scale; folding both sides into one canonical form
-- before comparing does.
--
-- Latin is chosen as that canonical form because transliteration only runs one
-- way without ambiguity. Cyrillic → Latin is a total function (`щ` is always
-- `sht`); Latin → Cyrillic is not (`sht` could be `щ` or `шт`). And because
-- Latin text transliterates to itself, one folded column covers both scripts —
-- there is no second index for the "other" alphabet.

/*
 * The folding function.
 *
 * Deliberately identical to `transliterate()` in `@catalog/shared`, character
 * for character, so a slug and a search term never disagree about what a word
 * is. Change one and you must change the other; `packages/shared/test/text.test.ts`
 * pins the mapping.
 *
 * IMMUTABLE is required — a generated column and an expression index both
 * depend on it. The flip side is that this function can no longer be replaced
 * in place once those exist: a future change means dropping the column and the
 * indexes, replacing the function, and recreating them, exactly as this
 * migration does.
 */
CREATE OR REPLACE FUNCTION catalog_translit(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT translate(
    replace(replace(replace(replace(replace(replace(replace(
      lower(input),
      'щ', 'sht'), 'ж', 'zh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'), 'ю', 'yu'), 'я', 'ya'),
    'абвгдезийклмнопрстуфхъь',
    'abvgdeziyklmnoprstufhay'
  )
$$;--> statement-breakpoint

-- The tsvector from 0002 indexed raw text, so it could only ever be matched by
-- a query in the same script as the product name. Rebuilt over folded text it
-- matches either. A generated column cannot have its expression altered, so it
-- is dropped and recreated; the dependent index goes with it.
ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";--> statement-breakpoint

ALTER TABLE "products"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', catalog_translit(coalesce("name", ''))), 'A') ||
    setweight(to_tsvector('simple', catalog_translit(coalesce("sku", ''))), 'A') ||
    setweight(to_tsvector('simple', catalog_translit(coalesce("weight", ''))), 'C') ||
    setweight(to_tsvector('simple', catalog_translit(coalesce("description_text", ''))), 'B')
  ) STORED;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_search_vector_idx"
  ON "products" USING gin ("search_vector");--> statement-breakpoint

/*
 * Trigram indexes over the same folded text, for the partial and misspelled
 * input a search box actually receives ("lavaz", "капсул"). These replace the
 * raw-text indexes from 0002: every query now folds its input first, so an
 * index on the unfolded column can never be used again.
 */
DROP INDEX IF EXISTS "products_name_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "brands_name_trgm_idx";--> statement-breakpoint

-- 0002 also indexed description trigrams. Nothing queried it — descriptions
-- are reached through the tsvector above — so it is dropped rather than
-- rebuilt, and the write path stops paying to maintain it.
DROP INDEX IF EXISTS "products_description_trgm_idx";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_name_translit_trgm_idx"
  ON "products" USING gin (catalog_translit("name") gin_trgm_ops);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "brands_name_translit_trgm_idx"
  ON "brands" USING gin (catalog_translit("name") gin_trgm_ops);--> statement-breakpoint

-- Typeahead resolves category names too, and there are few enough of them that
-- this index is about consistency with the other two rather than about speed.
CREATE INDEX IF NOT EXISTS "categories_name_translit_trgm_idx"
  ON "categories" USING gin (catalog_translit("name") gin_trgm_ops);--> statement-breakpoint

/*
 * Fuzzy name matching uses the `%>` operator rather than `similarity(...) > k`.
 * Plain similarity scores a short term against the *whole* name, so "lavaza"
 * against "Кафе на зърна Lavazza Crema E Aroma 1кг." scores 0.15 — under any
 * threshold that also excludes nonsense. `%>` scores the term against the best
 * matching run of words inside the name instead, which puts the same typo at
 * 0.71 while "zzzzqqqq" stays at 0.14.
 *
 * Its cut-off is a GUC, not a literal, because that is the form the trigram
 * index can accelerate. Pinning it on the database makes the search's
 * dependency on it explicit instead of inherited from whatever the server
 * happens to be configured with. 0.6 is also PostgreSQL's own default, so a
 * deployment where the role cannot alter the database still behaves correctly
 * — hence the swallowed exception rather than a failed migration.
 */
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.6',
    current_database()
  );
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm.word_similarity_threshold left at the server default (0.6)';
END
$$;
