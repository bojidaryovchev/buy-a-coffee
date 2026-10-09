-- Product URLs move once, from the supplier's wording to the shop's own
-- (`kapsuli-dg-rema-caffe-cookies-16-br` becomes
-- `rema-caffe-cookies-kapsuli-dolce-gusto-16-br`). Every address a product has
-- had is kept here, so the old one answers 308 to the new one for as long as
-- the row exists, and no later product is ever given it.
--
-- Additive, and safe to run twice: the running storefront reads neither
-- column, so this is applied ahead of the code that does and ahead of
-- `catalog:reslug`, which is what fills them for the products already stored.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "previous_slugs" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
-- The product page looks an unknown slug up here (`previous_slugs @> array[$1]`).
CREATE INDEX IF NOT EXISTS "products_previous_slugs_idx" ON "products" USING gin ("previous_slugs");
--> statement-breakpoint
-- The shop's own name for the product, for search only. Pages never read it:
-- they compute the name (`productName` in `@catalog/shared`). It is stored
-- because a search has to match the words a customer has just read on the
-- page ("Bianchi Adore", "Dolce Gusto", "Expert"), and `name` holds the
-- supplier's ("Adore", "DG"). Written by the sync on every run and by
-- `catalog:reslug`; null until one of them has run, and search then matches
-- the supplier's name alone, as it always has.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "search_name" text;
--> statement-breakpoint
-- The same folded trigram index `name` has (0003), for the same two
-- predicates: substring and word similarity.
CREATE INDEX IF NOT EXISTS "products_search_name_translit_trgm_idx"
  ON "products" USING gin (catalog_translit("search_name") gin_trgm_ops);
