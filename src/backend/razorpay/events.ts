/**
 * Razorpay's webhooks, read once their signature has been checked: which event, and
 * the payment (or refund) it's about, as the rules see a provider's payment.
 */
import type { ObservedPayment } from "@/backend/domain/provider-payments";
import * as z from "@/core/zod";
import { razorpayPaymentSchema, razorpayRefundSchema, type RazorpayPayment } from "./client";

/** The events the server acts on; anything else Razorpay sends is acknowledged and left. */
export const RAZORPAY_EVENTS = [
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "refund.processed",
] as const;

export const razorpayEventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({ entity: razorpayPaymentSchema }).optional(),
    refund: z.object({ entity: razorpayRefundSchema }).optional(),
  }),
  created_at: z.number().int(),
});
export type RazorpayEvent = z.infer<typeof razorpayEventSchema>;

/** A Razorpay payment as the rules see it. Null while nothing has been paid (`created`). */
export function observedPaymentOf(payment: RazorpayPayment): ObservedPayment | null {
  if (payment.status === "created") return null;
  return {
    providerPaymentId: payment.id,
    // A refunded payment was captured first; a refund is ours to have asked for.
    status: payment.status === "refunded" ? "captured" : payment.status,
    amountMinor: payment.amount,
    currency: payment.currency,
    instrument: payment.method,
    last4: payment.card?.last4 ?? null,
    occurredAtMs: payment.created_at * 1000,
  };
}
