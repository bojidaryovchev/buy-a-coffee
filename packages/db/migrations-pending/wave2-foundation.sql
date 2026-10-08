-- Cups per pack, written by the sync so listings can sort by price per cup.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "servings" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "servings_estimated" boolean;--> statement-breakpoint

-- Facts stated on the source's product page. Null when the source says nothing.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "arabica_percent" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "roast" text;
