-- Who an order is for and where it goes, so the call back only confirms it
-- (the owner's decision of 19 October 2026): first and last name, and a
-- delivery either to an address (postcode, street) or to a courier's office
-- or BOX NOW locker, with the courier chosen. The full name also keeps going
-- into `customer_name`, which older readers use.
--
-- Additive, and safe to run twice: every column is nullable, orders taken
-- before the change keep them null, and the running storefront reads none of
-- them, so this is applied ahead of the code that writes them.
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "first_name" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "last_name" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_method" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_courier" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_city" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_postcode" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_address" text;--> statement-breakpoint
ALTER TABLE "order_inquiries" ADD COLUMN IF NOT EXISTS "delivery_office" text;
