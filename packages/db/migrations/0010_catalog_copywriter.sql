-- The catalog copywriter: machine-written product copy for what the curated
-- file does not cover, and researched corrections of pack sizes.
--
-- Copy provenance. `copy_origin` says who wrote the override copy (`hand` for
-- `content/product-copy.ts`, `ai` for the copywriter, `edited` for an AI text
-- the owner corrected); `copy_source_hash` fingerprints the facts it was
-- written from, so stale AI copy can be found without a second source text;
-- `copy_attempts` / `copy_last_error` stop a product the copywriter cannot
-- handle from being retried every six hours.
--
-- Pack corrections. `pack_override_value` / `pack_override_unit` hold a size
-- confirmed by independent sources where the source's own listing was wrong;
-- the sync keeps them over its own reading. `facts_research` keeps every check,
-- applied or not, with its sources.
--
-- Additive, and safe to run twice: every column is nullable or defaulted, and
-- the running storefront reads none of them, so this is applied ahead of the
-- code that does (the storefront's queries and the sync's upsert both read
-- `pack_override_value` once deployed).
--
-- The column statements are what `pnpm db:generate` produced, made
-- re-runnable by hand; the 0010 snapshot beside this file is the generator's
-- own, so the next `db:generate` diffs from the truth.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_origin" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_source_hash" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_written_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_model" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_attempts" smallint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "copy_last_error" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pack_override_value" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pack_override_unit" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "facts_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "facts_research" jsonb;
--> statement-breakpoint
-- The curated copy that is already published is the hand-written file's: every
-- product with an override today got it from `copy:apply`.
UPDATE "products" SET "copy_origin" = 'hand'
WHERE "copy_origin" IS NULL
  AND ("description_text_override" IS NOT NULL OR "description_html_override" IS NOT NULL);
