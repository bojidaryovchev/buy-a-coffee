-- Packshot cut-outs (Phase K, K1; DESIGN.md, "Imagery"): each product photo
-- cut out to transparency by `pnpm images:cutout`, keyed by the photo's content
-- hash so a photo two products share is cut once. `status` says whether the
-- storefront may show it: `auto` (the two models agreed and nothing was
-- filled) and `approved` (a person said yes) are live; `pending` waits on
-- /admin/snimki; `rejected` keeps the white well and is never made again;
-- `failed` is retried by the next run, a few times.
--
-- Additive, and safe to run twice: a new type and a new table that nothing
-- reads until the code that uses them deploys.
DO $$ BEGIN
  CREATE TYPE "public"."cutout_status" AS ENUM('auto', 'pending', 'approved', 'rejected', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_cutouts" (
	"source_content_hash" text PRIMARY KEY NOT NULL,
	"object_key" text,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"agreement" numeric(5, 4),
	"shape" jsonb,
	"status" "cutout_status" NOT NULL,
	"made_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_cutouts_status_idx" ON "image_cutouts" USING btree ("status");
