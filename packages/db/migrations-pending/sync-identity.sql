-- Move detection (B2): a renamed source URL re-points the existing product row
-- instead of creating a twin. Every statement is safe to run twice.
ALTER TYPE "public"."change_type" ADD VALUE IF NOT EXISTS 'moved';
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "previous_source_keys" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "moved_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Brands and categories are renamed by the source too. They are matched on the
-- source's numeric id, updated in place, and remember the key they left.
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "previous_source_keys" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "previous_source_keys" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brands_source_id_idx" ON "brands" USING btree ("source_site_id","source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_source_id_idx" ON "categories" USING btree ("source_site_id","source_id");
