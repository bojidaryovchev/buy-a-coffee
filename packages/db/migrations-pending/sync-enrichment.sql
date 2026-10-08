-- Product-page enrichment (B5, B6): the product code and the stated facts are
-- read from the source's product pages by a step of their own. Every statement
-- is safe to run twice.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "characteristics" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "enrich_attempted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_sku_idx" ON "products" USING btree ("source_site_id","sku");
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "enriched_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "enrich_failed_count" integer DEFAULT 0 NOT NULL;
