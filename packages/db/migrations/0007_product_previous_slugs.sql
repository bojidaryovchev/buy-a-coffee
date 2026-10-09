-- Product URLs move once, from the supplier's wording to the shop's own
-- (`kapsuli-dg-rema-caffe-cookies-16-br` becomes
-- `rema-caffe-cookies-kapsuli-dolce-gusto-16-br`). Every address a product has
-- had is kept here, so the old one answers 308 to the new one for as long as
-- the row exists, and no later product is ever given it.
--
-- Additive, and safe to run twice: the running storefront does not read the
-- column, so this is applied ahead of the code that does and ahead of
-- `catalog:reslug`, which is what fills it.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "previous_slugs" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
-- The product page looks an unknown slug up here (`previous_slugs @> array[$1]`).
CREATE INDEX IF NOT EXISTS "products_previous_slugs_idx" ON "products" USING gin ("previous_slugs");
