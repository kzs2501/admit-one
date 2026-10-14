/**
 * Webhooks: the payment provider's word on whether a payment happened. They wait in
 * an outbox (persisted, so a reload doesn't lose them) and are processed idempotently
 * by event id — providers deliver at least once, so duplicates are normal, not errors.
 */
import type { BackendContext } from "./context";
import { isHoldLive } from "./inventory";
import { isOrderOpen, issueTickets, setOrderStatus } from "./orders";
import type { PaymentRecord } from "./state";

/** Gap between the two deliveries in the "webhook arrives twice" preset. */
export const DUPLICATE_GAP_MS = 700;

export function enqueuePaymentSucceeded(context: BackendContext, payment: PaymentRecord) {
  const eventId = context.deps.newId("evt");
  const deliverAtMs = context.deps.now() + context.chaos().webhookDelayMs;
  const delivery = { eventId, type: "payment.succeeded" as const, paymentId: payment.id };
  context.state.outbox.push({ deliveryId: context.deps.newId("dlv"), ...delivery, deliverAtMs });
  if (context.chaos().duplicateWebhook) {
    context.state.outbox.push({
      deliveryId: context.deps.newId("dlv"),
      ...delivery,
      deliverAtMs: deliverAtMs + DUPLICATE_GAP_MS,
    });
  }
}

/** The webhook, not the browser's redirect, is the source of truth for whether a payment happened. */
function processPaymentSucceeded(context: BackendContext, eventId: string, paymentId: string) {
  const { state } = context;
  if (state.processedEventIds.includes(eventId)) {
    context.log("webhook", `payment.succeeded ${eventId} arrived again — already processed, ignored.`);
    return;
  }
  state.processedEventIds.push(eventId);

  const payment = state.payments[paymentId];
  const order = payment ? state.orders[payment.orderId] : undefined;
  if (!payment || !order) {
    context.log("warn", `Webhook ${eventId} refers to an unknown payment; ignored.`);
    return;
  }
  if (!isOrderOpen(order)) {
    context.log("warn", `Webhook ${eventId} for ${order.id}, which is already ${order.status}; ignored.`);
    return;
  }
  context.log("webhook", `payment.succeeded ${eventId} received for ${payment.id}.`);
  payment.status = "succeeded";

  if (order.status === "failed") setOrderStatus(context, order, "pending");
  setOrderStatus(context, order, "paid");

  const hold = state.holds[order.holdId];
  if (hold && isHoldLive(hold, context.deps.now())) {
    hold.isConverted = true;
    for (const { tierId, quantity } of hold.items) state.sold[tierId] = (state.sold[tierId] ?? 0) + quantity;
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
    .sort((a, b) => a.deliverAtMs - b.deliverAtMs);
  if (!due.length) return 0;
  context.state.outbox = context.state.outbox.filter((delivery) => delivery.deliverAtMs > nowMs);
  for (const delivery of due) processPaymentSucceeded(context, delivery.eventId, delivery.paymentId);
  return due.length;
}
