CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'contacted', 'converted', 'cancelled', 'spam');--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"subject" text,
	"message" text NOT NULL,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"idempotency_key" text,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_source" text,
	"unsubscribed_at" timestamp with time zone,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"product_name" text,
	"product_slug" text,
	"customer_name" text,
	"phone" text NOT NULL,
	"email" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"source_page" text,
	"idempotency_key" text,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "retail_price_override" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "retail_old_price_override" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD CONSTRAINT "order_inquiries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_messages_idempotency_idx" ON "contact_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscribers_email_idx" ON "newsletter_subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "newsletter_subscribers_created_idx" ON "newsletter_subscribers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_inquiries_created_idx" ON "order_inquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_inquiries_status_idx" ON "order_inquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_inquiries_product_idx" ON "order_inquiries" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_inquiries_idempotency_idx" ON "order_inquiries" USING btree ("idempotency_key");