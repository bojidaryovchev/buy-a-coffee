CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets" USING btree ("reset_at");
