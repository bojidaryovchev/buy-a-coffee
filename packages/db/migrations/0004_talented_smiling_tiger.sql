CREATE TABLE "mail_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"direction" text NOT NULL,
	"from_address" text NOT NULL,
	"to_addresses" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"message_id" text,
	"in_reply_to" text,
	"attachments" jsonb
);
--> statement-breakpoint
CREATE TABLE "mail_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"correspondent" text NOT NULL,
	"correspondent_name" text,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_thread_idx" ON "mail_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_messages_message_id_idx" ON "mail_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_threads_last_message_at_idx" ON "mail_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "mail_threads_correspondent_idx" ON "mail_threads" USING btree ("correspondent");