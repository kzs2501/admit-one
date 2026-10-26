CREATE TABLE "provider_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payment_id" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"lease_until" timestamp with time zone,
	CONSTRAINT "provider_commands_kind_known" CHECK ("provider_commands"."kind" IN ('capture', 'refund'))
);
--> statement-breakpoint
ALTER TABLE "provider_commands" ADD CONSTRAINT "provider_commands_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_command_per_provider_payment" ON "provider_commands" USING btree ("kind","provider_payment_id");--> statement-breakpoint
CREATE INDEX "provider_commands_due" ON "provider_commands" USING btree ("created_at") WHERE "provider_commands"."done_at" IS NULL;