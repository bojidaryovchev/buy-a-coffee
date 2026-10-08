CREATE TABLE IF NOT EXISTS "sync_alerts" (
	"condition" text NOT NULL,
	"day" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_alerts_condition_day_pk" PRIMARY KEY("condition","day")
);
