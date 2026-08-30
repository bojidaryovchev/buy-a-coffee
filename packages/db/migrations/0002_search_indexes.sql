-- Search support for the storefront.
--
-- Hand written because it needs an extension, a generated column and operator
-- classes that the schema DSL cannot express.
--
-- Two complementary strategies, because neither alone is sufficient here:
--
--   * Full-text search over a generated tsvector handles whole-word queries
--     ("lavazza crema") with ranking. The `simple` configuration is used
--     deliberately: the catalog is Bulgarian and PostgreSQL ships no Bulgarian
--     stemmer, so a language-specific configuration would silently do nothing
--     useful while pretending to.
--
--   * Trigram indexes handle partial and misspelled input ("lavaz", "kapsul"),
--     which is what people actually type into a search box, and they work
--     identically for Cyrillic and Latin.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Generated so it can never drift from the columns it summarises.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("sku", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("weight", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("description_text", '')), 'B')
  ) STORED;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_search_vector_idx"
  ON "products" USING gin ("search_vector");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_description_trgm_idx"
  ON "products" USING gin ("description_text" gin_trgm_ops);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "brands_name_trgm_idx"
  ON "brands" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- Listing pages always filter on status first, then sort. A partial index on
-- active rows keeps the common path off the removed and missing products.
CREATE INDEX IF NOT EXISTS "products_active_name_idx"
  ON "products" ("name") WHERE "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_active_brand_idx"
  ON "products" ("brand_id") WHERE "status" = 'active';--> statement-breakpoint

-- Promotions: active products that carry a reduced price.
CREATE INDEX IF NOT EXISTS "products_active_promo_idx"
  ON "products" ("old_price") WHERE "status" = 'active' AND "old_price" IS NOT NULL;
