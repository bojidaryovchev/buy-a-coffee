-- The shop's own promotions (the owner's decision of 20 October 2026): a
-- percentage off chosen products, brands or categories for a run of days,
-- with each covered product's 30-day "before" price (`promotion_products`).
-- Order lines remember what a promotion took off them, and a newsletter draft
-- remembers what it was started from: the monthly letter, prepared once per
-- month (`auto_period`), or the announcement of one promotion.
--
-- Additive, and safe to run twice: two new tables nothing reads until the code
-- that uses them deploys, and nullable columns the running code never selects.
CREATE TABLE IF NOT EXISTS "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"percent_off" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"targets" jsonb DEFAULT '{"productIds":[],"brandIds":[],"categoryIds":[],"excludedProductIds":[]}'::jsonb NOT NULL,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_percent_off_range" CHECK ("promotions"."percent_off" between 1 and 50),
	CONSTRAINT "promotions_period_order" CHECK ("promotions"."ends_at" > "promotions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_products" (
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"reference_price" numeric(12, 2),
	"reference_at" timestamp with time zone,
	"reference_final" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "promotion_products_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "order_inquiry_items" ADD COLUMN IF NOT EXISTS "regular_unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "order_inquiry_items" ADD COLUMN IF NOT EXISTS "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "order_inquiry_items" ADD COLUMN IF NOT EXISTS "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "order_inquiry_items" ADD COLUMN IF NOT EXISTS "promotion_name" text;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN IF NOT EXISTS "template" text;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN IF NOT EXISTS "auto_period" text;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN IF NOT EXISTS "promotion_id" uuid;--> statement-breakpoint
-- `ADD CONSTRAINT` has no `IF NOT EXISTS`; the catalog is asked instead.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'promotion_products_promotion_id_promotions_id_fk'
	) THEN
		ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'promotion_products_product_id_products_id_fk'
	) THEN
		ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'order_inquiry_items_promotion_id_promotions_id_fk'
	) THEN
		ALTER TABLE "order_inquiry_items" ADD CONSTRAINT "order_inquiry_items_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_campaigns_promotion_id_promotions_id_fk'
	) THEN
		ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_products_product_idx" ON "promotion_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotions_period_idx" ON "promotions" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_campaigns_auto_period_idx" ON "newsletter_campaigns" USING btree ("auto_period") WHERE "newsletter_campaigns"."auto_period" is not null;
