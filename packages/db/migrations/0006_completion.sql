-- Everything built between 30 August and 9 October 2026, in one migration.
--
-- It was written as six separate files while several branches changed the
-- schema at once, and folded here before release. Every statement is safe to
-- run twice (IF NOT EXISTS, ADD VALUE IF NOT EXISTS), so a database that
-- already holds some of it — any development copy that ran the separate files
-- — takes the rest and changes nothing it already has.
--
-- Additive only: no column is dropped or retyped, so the running storefront is
-- unaffected when this is applied ahead of the code that uses it. It must be
-- applied ahead of that code: without `rate_limit_buckets` the new admin
-- sign-in refuses every attempt.

-- ==========================================================================
-- Following the source through renames
-- ==========================================================================

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
--> statement-breakpoint

-- ==========================================================================
-- Cups per pack, and stated facts about the coffee
-- ==========================================================================

-- Cups per pack, written by the sync so listings can sort by price per cup.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "servings" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "servings_estimated" boolean;--> statement-breakpoint

-- Facts stated on the source's product page. Null when the source says nothing.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "arabica_percent" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "roast" text;
--> statement-breakpoint

-- ==========================================================================
-- Reading product pages: the product code and the characteristics list
-- ==========================================================================

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
--> statement-breakpoint

-- ==========================================================================
-- The sync-health alarm sends each condition once a day
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "sync_alerts" (
	"condition" text NOT NULL,
	"day" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_alerts_condition_day_pk" PRIMARY KEY("condition","day")
);
--> statement-breakpoint

-- ==========================================================================
-- Rate limits shared across serverless instances
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets" USING btree ("reset_at");
--> statement-breakpoint

-- ==========================================================================
-- Newsletter consent and unsubscribe; when a contact message closed
-- ==========================================================================

-- Newsletter consent and unsubscribe (D10). The column is added with a volatile
-- default, so Postgres evaluates it once per existing row: every subscriber
-- already on the list gets its own token, and new rows get one from the same
-- default. Two UUIDs are 244 random bits, from the server's strong generator.
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "unsubscribe_token" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_unsubscribe_token_idx" ON "newsletter_subscribers" USING btree ("unsubscribe_token");
--> statement-breakpoint
-- When a contact message was closed (retention counts from here). Not
-- backfilled: a closed row without it is measured from creation, which can only
-- delete it earlier than the promise, never later.
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
