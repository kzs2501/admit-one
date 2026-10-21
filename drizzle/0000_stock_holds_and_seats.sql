CREATE TABLE "holds" (
	"id" text PRIMARY KEY NOT NULL,
	"event_slug" text NOT NULL,
	"items" jsonb NOT NULL,
	"seat_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_extended" boolean DEFAULT false NOT NULL,
	"order_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"tier_id" text PRIMARY KEY NOT NULL,
	"event_slug" text NOT NULL,
	"capacity" integer NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_within_capacity" CHECK ("inventory"."sold" >= 0 AND "inventory"."held" >= 0 AND "inventory"."sold" + "inventory"."held" <= "inventory"."capacity")
);
--> statement-breakpoint
CREATE TABLE "seat_claims" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seat_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_slug" text NOT NULL,
	"seat_id" text NOT NULL,
	"hold_id" text,
	"status" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holds_active_by_expiry" ON "holds" USING btree ("expires_at") WHERE "holds"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "one_claim_per_seat" ON "seat_claims" USING btree ("event_slug","seat_id") WHERE "seat_claims"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "seat_claims_by_hold" ON "seat_claims" USING btree ("hold_id");