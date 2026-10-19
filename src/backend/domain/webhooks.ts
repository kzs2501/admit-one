/**
 * Webhooks: the payment provider's word on whether a payment happened. They wait in
 * an outbox (persisted, so a reload doesn't lose them) and are processed idempotently
 * by event id — providers deliver at least once, so duplicates are normal, not errors.
 */
import type { BackendContext } from "./context";
import { isHoldLive } from "./inventory";
import { isOrderOpen, issueTickets, setOrderStatus } from "./orders";
import type { OrderRecord, OutboxItem, PaymentRecord } from "./state";

/** Gap between the two deliveries in the "webhook arrives twice" preset. */
export const DUPLICATE_GAP_MS = 700;

/** What the provider tells us about a payment: it happened, or it didn't and why. */
interface PaymentFailedEvent {
  type: "payment.failed";
  failureCode: "upi_declined";
}
type PaymentEvent = { type: "payment.succeeded" } | PaymentFailedEvent;

export function enqueuePaymentEvent(context: BackendContext, payment: PaymentRecord, event: PaymentEvent) {
  const eventId = context.deps.newId("evt");
  const deliverAtMs = context.deps.now() + context.chaos().webhookDelayMs;
  const deliveries = context.chaos().shouldDuplicateWebhook
    ? [deliverAtMs, deliverAtMs + DUPLICATE_GAP_MS]
    : [deliverAtMs];
  for (const at of deliveries) {
    context.state.outbox.push({
      deliveryId: context.deps.newId("dlv"),
      eventId,
      paymentId: payment.id,
      deliverAtMs: at,
      ...event,
    });
  }
}

export const enqueuePaymentSucceeded = (context: BackendContext, payment: PaymentRecord) => {
  enqueuePaymentEvent(context, payment, { type: "payment.succeeded" });
};

/**
 * Take an event for processing, once: providers deliver at least once, so a duplicate
 * is normal. Returns the payment and its order if there's anything left to do.
 */
function claim(context: BackendContext, { eventId, type, paymentId }: OutboxItem) {
  const { state } = context;
  if (state.processedEventIds.includes(eventId)) {
    context.log("webhook", `${type} ${eventId} arrived again — already processed, ignored.`);
    return null;
  }
  state.processedEventIds.push(eventId);

  const payment = state.payments[paymentId];
  const order = payment ? state.orders[payment.orderId] : undefined;
  if (!payment || !order) {
    context.log("warn", `Webhook ${eventId} refers to an unknown payment; ignored.`);
    return null;
  }
  if (!isOrderOpen(order)) {
    context.log("warn", `Webhook ${eventId} for ${order.id}, which is already ${order.status}; ignored.`);
    return null;
  }
  context.log("webhook", `${type} ${eventId} received for ${payment.id}.`);
  return { payment, order };
}

/** The webhook, not the browser's redirect, is the source of truth for whether a payment happened. */
function processPaymentSucceeded(context: BackendContext, payment: PaymentRecord, order: OrderRecord) {
  const { state } = context;
  payment.status = "succeeded";

  if (order.status === "failed") setOrderStatus(context, order, "pending");
  setOrderStatus(context, order, "paid");

  const hold = state.holds[order.holdId];
  if (hold && isHoldLive(hold, context.deps.now())) {
    hold.isConverted = true;
    for (const { tierId, quantity } of hold.items) state.sold[tierId] = (state.sold[tierId] ?? 0) + quantity;
    state.soldSeatIds.push(...hold.seatIds);
    issueTickets(context, order);
    setOrderStatus(context, order, "fulfilled");
  } else {
    // The money arrived but the tickets may already belong to someone else. The
    // policy: refund in full and say why, rather than oversell or keep the money.
    payment.status = "refunded";
    context.log("payment", `Refunded ${payment.id}: the hold expired before the payment was confirmed.`);
    setOrderStatus(
      context,
      order,
      "refunded",
      "Your payment went through after your reservation had expired, so we’ve refunded it in full.",
    );
  }
}

/** A payment the buyer approved, and their bank then refused — or that they declined in their UPI app. */
function processPaymentFailed(
  context: BackendContext,
  payment: PaymentRecord,
  order: OrderRecord,
  { failureCode }: PaymentFailedEvent,
) {
  if (payment.status !== "processing") {
    context.log("warn", `payment.failed for ${payment.id}, which is already ${payment.status}; ignored.`);
    return;
  }
  payment.status = "failed";
  payment.failureCode = failureCode;
  setOrderStatus(context, order, "failed", "The UPI payment was declined. No money was taken.");
}

/** When the next webhook is due, so the runtime can sleep until then. */
export function nextDeliveryAtMs(context: BackendContext): number | null {
  const { outbox } = context.state;
  return outbox.length ? Math.min(...outbox.map((delivery) => delivery.deliverAtMs)) : null;
}

/** Deliver every webhook that's due, oldest first. Returns how many were delivered. */
export function deliverDue(context: BackendContext): number {
  const nowMs = context.deps.now();
  const due = context.state.outbox
    .filter((delivery) => delivery.deliverAtMs <= nowMs)
    .sort((earlier, later) => earlier.deliverAtMs - later.deliverAtMs);
  if (!due.length) return 0;
  context.state.outbox = context.state.outbox.filter((delivery) => delivery.deliverAtMs > nowMs);
  for (const delivery of due) {
    const claimed = claim(context, delivery);
    if (!claimed) continue;
    if (delivery.type === "payment.succeeded") processPaymentSucceeded(context, claimed.payment, claimed.order);
    else processPaymentFailed(context, claimed.payment, claimed.order, delivery);
  }
  return due.length;
}
