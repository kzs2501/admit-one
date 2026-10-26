ALTER TABLE "payments" DROP CONSTRAINT "payments_method_known";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "instrument" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_by_provider_order" ON "payments" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_by_provider_payment" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_known" CHECK ("payments"."method" IN ('card', 'upi', 'razorpay'));