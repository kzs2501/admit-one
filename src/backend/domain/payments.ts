/**
 * Payments: starting a charge, the bank's 3-D Secure challenge, and the outcomes a
 * provider's test mode offers. A successful charge doesn't mark the order paid — it
 * schedules the webhook that will. Every attempted charge returns its payment, whatever
 * the bank said; errors are reserved for requests that couldn't be attempted at all.
 */
import { cardSchema } from "@/core/schemas";
import type { BackendContext } from "./context";
import { isPaymentInFlight, setOrderStatus, settleExpiry } from "./orders";
import { fail, ok, type Result } from "./result";
import type { OrderRecord, PaymentRecord } from "./state";
import { enqueuePaymentSucceeded } from "./webhooks";

/** How long starting a payment keeps a hold alive, so a buyer mid-payment isn't cut off. */
export const PAYMENT_GRACE_MS = 2 * 60_000;
/** The "hold expires mid-payment" preset leaves this long on the clock. */
export const LAST_SECONDS_MS = 3_000;

/** Card numbers with special meaning, as payment providers' test modes have. */
export const TEST_CARDS = {
  success: "4242424242424242",
  decline: "4000000000000002",
  challenge: "4000002500003155",
} as const;

export type PaymentAttempt = { payment: PaymentRecord; order: OrderRecord };

export function createPayment(context: BackendContext, orderId: string, body: unknown): Result<PaymentAttempt> {
  const { state } = context;
  const order = state.orders[orderId];
  if (!order) return fail(404, "not_found", "That order doesn’t exist.");
  settleExpiry(context, order);
  if (order.status === "expired") return fail(410, "hold_expired", "Your reservation expired before payment.");
  if (isPaymentInFlight(context, order)) {
    return fail(409, "payment_in_progress", "A payment is already in progress.");
  }
  if (order.status !== "pending" && order.status !== "failed") {
    return fail(409, "already_completed", "This order is already paid.");
  }
  const card = cardSchema.safeParse(body);
  if (!card.success) return fail(422, "invalid_card", card.error.issues[0].message);

  const nowMs = context.deps.now();
  const { number } = card.data;
  const outcome =
    context.chaos().forceOutcome ??
    (number === TEST_CARDS.decline ? "decline" : number === TEST_CARDS.challenge ? "challenge" : "success");

  if (order.status === "failed") setOrderStatus(context, order, "pending", "retrying payment");

  const payment: PaymentRecord = {
    id: context.deps.newId("pay"),
    orderId,
    amountCents: order.amounts.totalCents,
    status: outcome === "decline" ? "failed" : outcome === "challenge" ? "requires_action" : "processing",
    last4: number.slice(-4),
    failureCode: outcome === "decline" ? "card_declined" : null,
    createdAt: nowMs,
  };
  state.payments[payment.id] = payment;
  order.paymentId = payment.id;
  context.log("payment", `Payment ${payment.id} for ${order.id}: ${payment.status}.`);

  // A decline is an outcome, not an error: the charge was attempted and the bank said
  // no. The HTTP layer turns a failed payment into a 402.
  if (outcome === "decline") {
    setOrderStatus(context, order, "failed", "Your card was declined.");
    return ok({ payment, order });
  }

  const hold = state.holds[order.holdId];
  if (context.chaos().expireHoldDuringPayment) {
    hold.expiresAt = nowMs + LAST_SECONDS_MS;
    context.log("hold", `Hold ${hold.id} has ${LAST_SECONDS_MS / 1000}s left as payment starts.`);
  } else if (!hold.extended) {
    hold.expiresAt = Math.max(hold.expiresAt, nowMs + PAYMENT_GRACE_MS);
    hold.extended = true;
    context.log("hold", `Hold ${hold.id} extended while the payment completes.`);
  }
  if (outcome === "success") enqueuePaymentSucceeded(context, payment);
  return ok({ payment, order }, 202);
}

/** The buyer's answer to the bank's authentication challenge. */
export function confirmChallenge(
  context: BackendContext,
  paymentId: string,
  isApproved: boolean,
): Result<PaymentAttempt> {
  const payment = context.state.payments[paymentId];
  if (!payment) return fail(404, "not_found", "That payment doesn’t exist.");
  if (payment.status !== "requires_action") {
    return fail(409, "invalid_state", "That payment isn’t waiting for authentication.");
  }
  const order = context.state.orders[payment.orderId];

  if (isApproved) {
    payment.status = "processing";
    context.log("payment", `Payment ${payment.id} authenticated; processing.`);
    enqueuePaymentSucceeded(context, payment);
    return ok({ payment, order }, 202);
  }
  payment.status = "failed";
  payment.failureCode = "authentication_failed";
  setOrderStatus(context, order, "failed", "Your bank couldn’t authenticate the payment.");
  return ok({ payment, order });
}
