CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"status" integer,
	"body" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"hold_id" text NOT NULL,
	"event_slug" text NOT NULL,
	"items" jsonb NOT NULL,
	"attendees" jsonb NOT NULL,
	"add_ons" jsonb NOT NULL,
	"amounts" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"tickets" jsonb NOT NULL,
	"payment_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_hold_id_unique" UNIQUE("hold_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"method" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"last4" text,
	"upi_expires_at" timestamp with time zone,
	"webhook_lag_ms" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payment_id" text,
	"failure_code" text,
	"enqueued_at" timestamp with time zone NOT NULL,
	"deliver_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_by_order" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "provider_events_due" ON "provider_events" USING btree ("deliver_at") WHERE "provider_events"."delivered_at" IS NULL;