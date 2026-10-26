/**
 * Razorpay's two signatures, both a hex HMAC-SHA256:
 * - a webhook's `X-Razorpay-Signature`, over its raw body, under the webhook secret;
 * - what Checkout hands back after a payment, over `order_id|payment_id`, under the key
 *   secret: proof the buyer's browser didn't make the ids up.
 *
 * Neither carries a timestamp, so a replay can't be refused by age the way the
 * simulated provider's can (`postgres/provider.ts`). Event ids are deduplicated, and a
 * payment settles once whatever tells us about it, which is what makes a replay harmless.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const RAZORPAY_SIGNATURE_HEADER = "X-Razorpay-Signature";
export const RAZORPAY_EVENT_ID_HEADER = "X-Razorpay-Event-Id";

const HEX_DIGEST = /^[0-9a-f]{64}$/;

export const razorpaySignature = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

/** Whether `signature` is `payload`'s, compared in constant time, so the time taken doesn't hint at the right one. */
export function isRazorpaySignature(secret: string, payload: string, signature: string): boolean {
  if (!HEX_DIGEST.test(signature)) return false;
  return timingSafeEqual(Buffer.from(razorpaySignature(secret, payload), "hex"), Buffer.from(signature, "hex"));
}

/** What Checkout signs: the order and the payment made against it. */
export const checkoutPayload = (razorpayOrderId: string, razorpayPaymentId: string) =>
  `${razorpayOrderId}|${razorpayPaymentId}`;
