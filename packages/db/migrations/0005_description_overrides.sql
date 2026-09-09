-- Original product copy, owned by us rather than by the sync.
--
-- The catalog sync overwrites `description_html` and `description_text` from
-- the source on every run (see `upsertProduct`), so rewritten copy stored in
-- those columns would survive exactly until the next `pnpm sync:catalog`.
--
-- These override columns follow the precedent already set by
-- `retail_price_override`: the source value stays untouched and auditable, the
-- storefront reads `coalesce(override, source)`, and the sync deliberately
-- never writes the override. That keeps two independent facts separable —
-- what the source says, and what we publish.
--
-- Why this matters beyond tidiness: both sites sell the same catalogue, so
-- identical product copy on both is duplicate content. `description_text`
-- feeds the product page, the meta description and the Product JSON-LD, which
-- are precisely the fields a search engine compares.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "description_text_override" text;--> statement-breakpoint

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "description_html_override" text;--> statement-breakpoint

/*
 * Search has to match the text the customer actually reads.
 *
 * The generated `search_vector` from 0003 folds `description_text`. Left
 * alone it would index the source copy while the page renders ours, so a
 * phrase visible on the page would return no result and a phrase that appears
 * nowhere would. The expression of a generated column cannot be altered, so
 * the column is dropped and recreated; its index goes with it.
 */
ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";--> statement-breakpoint

ALTER TABLE "products"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', catalog_translit(coalesce("name", ''))), 'A') ||
    setweight(to_tsvector('simple', catalog_translit(coalesce("sku", ''))), 'A') ||
    setweight(to_tsvector('simple', catalog_translit(coalesce("weight", ''))), 'C') ||
    setweight(
      to_tsvector(
        'simple',
        catalog_translit(coalesce("description_text_override", "description_text", ''))
      ),
      'B'
    )
  ) STORED;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_search_vector_idx"
  ON "products" USING gin ("search_vector");--> statement-breakpoint

-- Lets the originality report find products still shipping source copy
-- without scanning the whole table.
CREATE INDEX IF NOT EXISTS "products_description_override_idx"
  ON "products" ("status")
  WHERE "description_text_override" IS NULL;
