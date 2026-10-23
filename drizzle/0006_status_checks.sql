ALTER TABLE "holds" ADD CONSTRAINT "holds_status_known" CHECK ("holds"."status" IN ('active', 'expired', 'converted'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_known" CHECK ("orders"."status" IN ('pending', 'paid', 'fulfilled', 'failed', 'expired', 'refunded'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_known" CHECK ("payments"."status" IN ('processing', 'requires_action', 'succeeded', 'failed', 'refunded'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_known" CHECK ("payments"."method" IN ('card', 'upi'));--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_status_known" CHECK ("seat_claims"."status" IN ('held', 'sold'));