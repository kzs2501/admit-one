/**
 * Payments: starting a charge by card or UPI, the bank's 3-D Secure challenge, the
 * buyer's answer in their UPI app, and the outcomes a provider's test mode offers. A
 * successful payment doesn't mark the order paid — it schedules the webhook that will.
 * Every attempted payment returns its payment, whatever the bank said; errors are
 * reserved for requests that couldn't be attempted at all.
 */
import { own } from "./state";
import type { CardDetails } from "@/core/schemas";
import type { PaymentMethod } from "@/core/statuses";
import type { BackendContext } from "./context";
import { isOrderOpen, isPaymentInFlight, resolvePayment, setOrderStatus, settleExpiry } from "./orders";
import { fail, ok, type Result } from "./errors";
import type { OrderRecord, PaymentRecord } from "./state";
import { enqueuePaymentEvent, enqueuePaymentSucceeded } from "./webhooks";

/** How long starting a card payment keeps a hold alive, so a buyer mid-payment isn't cut off. */
export const PAYMENT_GRACE_MS = 2 * 60_000;
/** The "hold expires mid-payment" preset leaves this long on the clock. */
export const LAST_SECONDS_MS = 3_000;

/** Card numbers with special meaning, as payment providers' test modes have. */
export const TEST_CARDS = {
  success: "4242424242424242",
  decline: "4000000000000002",
  challenge: "4000002500003155",
} as const;

/** How the buyer chose to pay. */
export type PaymentInput = ({ method: "card" } & CardDetails) | { method: "upi" } | { method: "razorpay" };

/**
 * A Razorpay checkout to open: the order Razorpay holds for it, made first — it's a
 * call over the network, so it's made before any lock is taken — and what it charges.
 */
export interface RazorpayCheckout {
  paymentId: string;
  providerOrderId: string;
  amountMinor: number;
}

/** How long a Razorpay checkout stays payable, at most: the hold is kept that long, once. */
export const CHECKOUT_WINDOW_MS = 5 * 60_000;

export interface PaymentAttempt {
  payment: PaymentRecord;
  order: OrderRecord;
}

export type ChallengeDecision = "approve" | "reject";
export type UpiAppDecision = "approve" | "decline";

function record(context: BackendContext, order: OrderRecord, payment: PaymentRecord) {
  context.state.payments[payment.id] = payment;
  order.paymentId = payment.id;
  context.log("payment", `Payment ${payment.id} for ${order.id} by ${payment.method}: ${payment.status}.`);
}

/** Keep the hold alive while the payment completes — once — or, in "hold expires mid-payment", nearly let it go. */
function keepHoldThroughPayment(context: BackendContext, order: OrderRecord, graceMs: number) {
  const hold = context.state.holds[order.holdId];
  if (!hold) return;
  const nowMs = context.deps.now();
  if (context.chaos().shouldExpireHoldDuringPayment) {
    hold.expiresAtMs = nowMs + LAST_SECONDS_MS;
    context.log("hold", `Hold ${hold.id} has ${String(LAST_SECONDS_MS / 1000)}s left as payment starts.`);
  } else if (!hold.isExtended) {
    hold.expiresAtMs = Math.max(hold.expiresAtMs, nowMs + graceMs);
    hold.isExtended = true;
    context.log("hold", `Hold ${hold.id} extended while the payment completes.`);
  }
}

function chargeCard(context: BackendContext, order: OrderRecord, { number }: CardDetails): PaymentAttempt {
  const outcome =
    context.chaos().forcedOutcome ??
    (number === TEST_CARDS.decline ? "decline" : number === TEST_CARDS.challenge ? "challenge" : "success");
  const payment: PaymentRecord = {
    id: context.deps.newId("pay"),
    orderId: order.id,
    method: "card",
    amountMinor: order.amounts.totalMinor,
    status: outcome === "decline" ? "failed" : outcome === "challenge" ? "requires_action" : "processing",
    last4: number.slice(-4),
    failureCode: outcome === "decline" ? "card_declined" : null,
    webhookLagMs: null,
    createdAtMs: context.deps.now(),
  };
  record(context, order, payment);

  // A decline is an outcome, not an error: the charge was attempted and the bank said
  // no. The HTTP layer turns a failed payment into a 402.
  if (outcome === "decline") {
    setOrderStatus(context, order, "failed", "Your card was declined.");
    return { payment, order };
  }
  keepHoldThroughPayment(context, order, PAYMENT_GRACE_MS);
  if (outcome === "success") enqueuePaymentSucceeded(context, payment);
  return { payment, order };
}

/**
 * A UPI payment request, for the buyer to approve in their UPI app. The hold is kept
 * for as long as the request lasts, and the request never outlasts the hold: approving
 * it after the seats were released could only end in a refund.
 */
function requestUpiPayment(context: BackendContext, order: OrderRecord): PaymentAttempt {
  const nowMs = context.deps.now();
  const { upiRequestMs } = context.chaos();
  keepHoldThroughPayment(context, order, upiRequestMs);
  const holdExpiresAtMs = context.state.holds[order.holdId]?.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
  const payment: PaymentRecord = {
    id: context.deps.newId("pay"),
    orderId: order.id,
    method: "upi",
    amountMinor: order.amounts.totalMinor,
    status: "requires_action",
    failureCode: null,
    webhookLagMs: null,
    expiresAtMs: Math.min(nowMs + upiRequestMs, holdExpiresAtMs),
    createdAtMs: nowMs,
  };
  record(context, order, payment);
  return { payment, order };
}

/** The ways this order can be paid: what the provider takes, less UPI for anything but rupees. */
export const offeredPaymentMethods = (context: BackendContext, order: OrderRecord): PaymentMethod[] =>
  context.paymentMethods.filter((method) => method !== "upi" || order.amounts.currency === "INR");

/**
 * The buyer's Razorpay checkout, waiting for them to pay on Razorpay's page. Like a UPI
 * request, it never outlasts the hold. What happens there reaches this server as
 * Razorpay's webhook, or as Checkout's signed result — never as the browser's say-so.
 */
function openCheckout(context: BackendContext, order: OrderRecord, checkout: RazorpayCheckout): PaymentAttempt {
  const nowMs = context.deps.now();
  keepHoldThroughPayment(context, order, CHECKOUT_WINDOW_MS);
  const holdExpiresAtMs = context.state.holds[order.holdId]?.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
  const payment: PaymentRecord = {
    id: checkout.paymentId,
    orderId: order.id,
    method: "razorpay",
    amountMinor: checkout.amountMinor,
    status: "requires_action",
    failureCode: null,
    webhookLagMs: null,
    providerOrderId: checkout.providerOrderId,
    providerPaymentId: null,
    instrument: null,
    last4: null,
    expiresAtMs: Math.min(nowMs + CHECKOUT_WINDOW_MS, holdExpiresAtMs),
    createdAtMs: nowMs,
  };
  record(context, order, payment);
  return { payment, order };
}

const NO_RAZORPAY_ORDER = {
  code: "invalid_state",
  detail: "A Razorpay payment needs Razorpay’s order first.",
} as const;

/**
 * Whether the order can be paid now, by this method: what `createPayment` checks first.
 * The server asks before it makes a Razorpay order, so it doesn't make one for nothing.
 */
export function checkPayable(
  context: BackendContext,
  orderId: string,
  method: PaymentInput["method"],
): Result<OrderRecord> {
  const order = own(context.state.orders, orderId);
  if (!order) return fail({ code: "not_found", detail: "That order doesn’t exist." });
  settleExpiry(context, order);
  if (order.status === "expired") {
    return fail({ code: "hold_expired", detail: "Your reservation expired before payment." });
  }
  if (isPaymentInFlight(context, order)) {
    return fail({ code: "payment_in_progress", detail: "A payment is already in progress." });
  }
  if (!isOrderOpen(order)) return fail({ code: "already_completed", detail: "This order is already paid." });
  if (method === "upi" && order.amounts.currency !== "INR") {
    return fail({ code: "invalid_request", detail: "UPI can only pay in rupees." });
  }
  if (!offeredPaymentMethods(context, order).includes(method)) {
    return fail({
      code: "payment_method_unavailable",
      detail: "That way to pay isn’t taken here. Choose one of the ways this order offers.",
    });
  }
  return ok(order);
}

export function createPayment(
  context: BackendContext,
  orderId: string,
  input: PaymentInput,
  checkout?: RazorpayCheckout,
): Result<PaymentAttempt> {
  const payable = checkPayable(context, orderId, input.method);
  if (!payable.ok) return payable;
  const order = payable.value;
  if (input.method === "razorpay") {
    if (!checkout) return fail(NO_RAZORPAY_ORDER);
    // The order was priced when Razorpay's was made; if it's changed since, that one's wrong.
    if (checkout.amountMinor !== order.amounts.totalMinor) {
      return fail({ code: "invalid_state", detail: "The order changed while the payment was starting. Try again." });
    }
  }

  if (order.status === "failed") setOrderStatus(context, order, "pending", "retrying payment");
  switch (input.method) {
    case "upi":
      return ok(requestUpiPayment(context, order));
    case "razorpay":
      return checkout ? ok(openCheckout(context, order, checkout)) : fail(NO_RAZORPAY_ORDER);
    case "card":
      return ok(chargeCard(context, order, input));
  }
}

/** The buyer's answer to the bank's authentication challenge. */
export function confirmChallenge(
  context: BackendContext,
  paymentId: string,
  decision: ChallengeDecision,
): Result<PaymentAttempt> {
  const payment = own(context.state.payments, paymentId);
  if (!payment) return fail({ code: "not_found", detail: "That payment doesn’t exist." });
  const order = context.state.orders[payment.orderId];
  if (!order || payment.method !== "card" || payment.status !== "requires_action") {
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

/**
 * The buyer's answer in their UPI app. It happens outside this API, between the buyer,
 * their app and their bank — so whichever way it goes, the merchant hears it from the
 * payment provider's webhook, never from the browser.
 */
export function respondInUpiApp(
  context: BackendContext,
  paymentId: string,
  decision: UpiAppDecision,
): Result<PaymentAttempt> {
  const payment = own(context.state.payments, paymentId);
  if (!payment) return fail({ code: "not_found", detail: "That payment doesn’t exist." });
  const order = context.state.orders[payment.orderId];
  if (!order || payment.method !== "upi" || resolvePayment(context, payment).status !== "requires_action") {
    return fail({ code: "invalid_state", detail: "That UPI request isn’t waiting for an answer." });
  }

  payment.status = "processing";
  const isDeclined = decision === "decline" || context.chaos().shouldDeclineUpi;
  context.log(
    "payment",
    `The buyer ${decision === "approve" ? "approved" : "declined"} ${payment.id} in their UPI app.`,
  );
  enqueuePaymentEvent(
    context,
    payment,
    isDeclined ? { type: "payment.failed", failureCode: "upi_declined" } : { type: "payment.succeeded" },
  );
  return ok({ payment, order });
}

/**
 * Give up on a payment the buyer hasn't approved — a UPI request, say — to pay another
 * way. Once the buyer has approved it, it's too late: the money may already be moving.
 * Cancelling twice is harmless, and answers the same.
 */
export function cancelPayment(context: BackendContext, paymentId: string): Result<PaymentAttempt> {
  const payment = own(context.state.payments, paymentId);
  const order = payment ? context.state.orders[payment.orderId] : undefined;
  if (!payment || !order) return fail({ code: "not_found", detail: "That payment doesn’t exist." });
  settleExpiry(context, order);
  if (payment.failureCode === "cancelled") return ok({ payment, order });
  if (payment.status !== "requires_action") {
    return fail({
      code: "invalid_state",
      detail:
        payment.status === "processing"
          ? "That payment has been approved and is being processed, so it can’t be cancelled."
          : "That payment is already over.",
    });
  }

  payment.status = "failed";
  payment.failureCode = "cancelled";
  setOrderStatus(context, order, "failed", "You cancelled the payment.");
  return ok({ payment, order });
}

type UpiPaymentRecord = PaymentRecord & { method: "upi" };

/** The newest UPI request still waiting for the buyer — what their phone would be showing. */
export function findPendingUpiRequest(context: BackendContext): UpiPaymentRecord | undefined {
  return Object.values(context.state.payments)
    .filter((payment): payment is UpiPaymentRecord => payment.method === "upi")
    .filter((payment) => resolvePayment(context, payment).status === "requires_action")
    .sort((earlier, later) => later.createdAtMs - earlier.createdAtMs)[0];
}
