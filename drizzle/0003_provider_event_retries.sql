ALTER TABLE "provider_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "provider_events" ADD COLUMN "lease_until" timestamp with time zone;