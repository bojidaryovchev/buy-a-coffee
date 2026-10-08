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
