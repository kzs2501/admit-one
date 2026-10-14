/**
 * Payments: starting a charge, the bank's 3-D Secure challenge, and the outcomes a
 * provider's test mode offers. A successful charge doesn't mark the order paid — it
 * schedules the webhook that will. Every attempted charge returns its payment, whatever
 * the bank said; errors are reserved for requests that couldn't be attempted at all.
 */
import type { CardDetails } from "@/core/schemas";
import type { BackendContext } from "./context";
import { isOrderOpen, isPaymentInFlight, setOrderStatus, settleExpiry } from "./orders";
import { fail, ok, type Result } from "./errors";
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

export type ChallengeDecision = "approve" | "reject";

export function createPayment(context: BackendContext, orderId: string, card: CardDetails): Result<PaymentAttempt> {
  const { state } = context;
  const order = state.orders[orderId];
  if (!order) return fail({ code: "not_found", detail: "That order doesn’t exist." });
  settleExpiry(context, order);
  if (order.status === "expired") {
    return fail({ code: "hold_expired", detail: "Your reservation expired before payment." });
  }
  if (isPaymentInFlight(context, order)) {
    return fail({ code: "payment_in_progress", detail: "A payment is already in progress." });
  }
  if (!isOrderOpen(order)) return fail({ code: "already_completed", detail: "This order is already paid." });

  const nowMs = context.deps.now();
  const { number } = card;
  const outcome =
    context.chaos().forceOutcome ??
    (number === TEST_CARDS.decline ? "decline" : number === TEST_CARDS.challenge ? "challenge" : "success");

  if (order.status === "failed") setOrderStatus(context, order, "pending", "retrying payment");

  const payment: PaymentRecord = {
    id: context.deps.newId("pay"),
    orderId,
    amountMinor: order.amounts.totalMinor,
    status: outcome === "decline" ? "failed" : outcome === "challenge" ? "requires_action" : "processing",
    last4: number.slice(-4),
    failureCode: outcome === "decline" ? "card_declined" : null,
    createdAtMs: nowMs,
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
  if (hold && context.chaos().expireHoldDuringPayment) {
    hold.expiresAtMs = nowMs + LAST_SECONDS_MS;
    context.log("hold", `Hold ${hold.id} has ${LAST_SECONDS_MS / 1000}s left as payment starts.`);
  } else if (hold && !hold.isExtended) {
    hold.expiresAtMs = Math.max(hold.expiresAtMs, nowMs + PAYMENT_GRACE_MS);
    hold.isExtended = true;
    context.log("hold", `Hold ${hold.id} extended while the payment completes.`);
  }
  if (outcome === "success") enqueuePaymentSucceeded(context, payment);
  return ok({ payment, order });
}

/** The buyer's answer to the bank's authentication challenge. */
export function confirmChallenge(
  context: BackendContext,
  paymentId: string,
  decision: ChallengeDecision,
): Result<PaymentAttempt> {
  const payment = context.state.payments[paymentId];
  if (!payment) return fail({ code: "not_found", detail: "That payment doesn’t exist." });
  const order = context.state.orders[payment.orderId];
  if (!order || payment.status !== "requires_action") {
    return fail({ code: "invalid_state", detail: "That payment isn’t waiting for authentication." });
  }

  if (decision === "approve") {
    payment.status = "processing";
    context.log("payment", `Payment ${payment.id} authenticated; processing.`);
    enqueuePaymentSucceeded(context, payment);
    return ok({ payment, order });
  }
  payment.status = "failed";
  payment.failureCode = "authentication_failed";
  setOrderStatus(context, order, "failed", "Your bank couldn’t authenticate the payment.");
  return ok({ payment, order });
}
