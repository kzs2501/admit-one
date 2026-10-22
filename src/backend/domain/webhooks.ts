/**
 * Webhooks: the payment provider's word on whether a payment happened, and whether a
 * refund went through. They wait in an outbox (persisted, so a reload doesn't lose
 * them) and are processed idempotently by event id — providers deliver at least once,
 * so duplicates are normal, not errors.
 */
import { own } from "./state";
import type { BackendContext } from "./context";
import { findHistoricalOrder } from "./history";
import { findLiveSale } from "./reporting";
import { isHoldLive, returnToSale } from "./inventory";
import { isOrderOpen, issueTickets, setOrderStatus } from "./orders";
import type { OrderRecord, OutboxItem, PaymentRecord, RefundRecord } from "./state";

/** Gap between the two deliveries in the "webhook arrives twice" preset. */
export const DUPLICATE_GAP_MS = 700;

/** What the provider tells us about a payment: it happened, or it didn't and why. */
interface PaymentFailedEvent {
  type: "payment.failed";
  failureCode: "upi_declined";
}
type PaymentEvent = { type: "payment.succeeded" } | PaymentFailedEvent;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event as the provider sends it, before the outbox schedules its delivery. */
type ProviderEvent = DistributiveOmit<OutboxItem, "deliveryId" | "eventId" | "enqueuedAtMs" | "deliverAtMs">;

function enqueue(context: BackendContext, event: ProviderEvent) {
  const eventId = context.deps.newId("evt");
  const enqueuedAtMs = context.deps.now();
  const deliverAtMs = enqueuedAtMs + context.chaos().webhookDelayMs;
  const deliveries = context.chaos().shouldDuplicateWebhook
    ? [deliverAtMs, deliverAtMs + DUPLICATE_GAP_MS]
    : [deliverAtMs];
  for (const at of deliveries) {
    context.state.outbox.push({
      deliveryId: context.deps.newId("dlv"),
      eventId,
      enqueuedAtMs,
      deliverAtMs: at,
      ...event,
    });
  }
}

export function enqueuePaymentEvent(context: BackendContext, payment: PaymentRecord, event: PaymentEvent) {
  enqueue(context, { ...event, paymentId: payment.id });
}

export function enqueueRefundSucceeded(context: BackendContext, refund: RefundRecord) {
  enqueue(context, { type: "refund.succeeded", refundId: refund.id });
}

export const enqueuePaymentSucceeded = (context: BackendContext, payment: PaymentRecord) => {
  enqueuePaymentEvent(context, payment, { type: "payment.succeeded" });
};

/** Take an event for processing, once: providers deliver at least once, so a duplicate is normal. */
function isFirstDelivery(context: BackendContext, { eventId, type }: OutboxItem) {
  const { state } = context;
  if (state.processedEventIds.includes(eventId)) {
    context.log("webhook", `${type} ${eventId} arrived again — already processed, ignored.`);
    return false;
  }
  state.processedEventIds.push(eventId);
  return true;
}

/** The payment an event is about, and its order, if there's anything left to do. */
function claimPayment(
  context: BackendContext,
  { eventId, type, enqueuedAtMs, ...event }: OutboxItem & { paymentId: string },
) {
  const { state } = context;
  const payment = own(state.payments, event.paymentId);
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
  payment.webhookLagMs = context.deps.now() - enqueuedAtMs;
  return { payment, order };
}

/**
 * The webhook, not the browser's redirect, is the source of truth for whether a payment
 * happened. It's judged by when the payment happened (`occurredAtMs`), not when its
 * webhook happened to be delivered: a payment confirmed while its hold was live keeps
 * its tickets, if the hold still has them.
 */
function processPaymentSucceeded(
  context: BackendContext,
  payment: PaymentRecord,
  order: OrderRecord,
  occurredAtMs: number,
) {
  const { state } = context;
  payment.status = "succeeded";

  if (order.status === "failed") setOrderStatus(context, order, "pending");
  setOrderStatus(context, order, "paid");

  const hold = state.holds[order.holdId];
  if (hold && isHoldLive(hold, occurredAtMs) && context.hasItsTickets(hold)) {
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

/**
 * The provider has returned the money. The order is refunded and its tickets void,
 * and they go back on sale — whether the order is from this sandbox or from before it.
 */
function processRefundSucceeded(context: BackendContext, { eventId, refundId }: { eventId: string; refundId: string }) {
  const { state } = context;
  const refund = own(state.refunds, refundId);
  if (refund?.status !== "pending") {
    context.log("warn", `refund.succeeded ${eventId} for a refund that isn't pending; ignored.`);
    return;
  }
  context.log("webhook", `refund.succeeded ${eventId} received for ${refund.id}.`);
  refund.status = "succeeded";
  refund.settledAtMs = context.deps.now();

  const order = state.orders[refund.orderId];
  if (order) {
    setOrderStatus(context, order, "refunded", "The organiser refunded this order in full.");
    // The tickets stop working: kept as voided, so the event's doors can be told.
    const voided = (state.voidedTickets[order.eventSlug] ??= []);
    for (const ticket of order.tickets) voided.push({ code: ticket.code, voidedAtMs: context.deps.now() });
    order.tickets = [];
    const payment = order.paymentId ? state.payments[order.paymentId] : undefined;
    if (payment) payment.status = "refunded";
    const hold = state.holds[order.holdId];
    returnToSale(context, { items: order.items, seatIds: hold?.seatIds ?? [], isFromHistory: false });
    return;
  }
  const liveSale = findLiveSale(context, refund.orderId);
  if (liveSale) {
    returnToSale(context, {
      items: [{ tierId: liveSale.tierId, quantity: liveSale.quantity }],
      seatIds: liveSale.seatIds,
      isFromHistory: false,
    });
    return;
  }
  const historical = findHistoricalOrder(refund.orderId);
  if (historical) {
    returnToSale(context, {
      items: [{ tierId: historical.tierId, quantity: historical.quantity }],
      seatIds: historical.seatIds,
      isFromHistory: true,
    });
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
    .sort((earlier, later) => earlier.deliverAtMs - later.deliverAtMs);
  if (!due.length) return 0;
  context.state.outbox = context.state.outbox.filter((delivery) => delivery.deliverAtMs > nowMs);
  for (const delivery of due) {
    if (!isFirstDelivery(context, delivery)) continue;
    if (delivery.type === "refund.succeeded") {
      processRefundSucceeded(context, delivery);
      continue;
    }
    const claimed = claimPayment(context, delivery);
    if (!claimed) continue;
    // The provider confirmed it when it fell due; it may be delivered later.
    if (delivery.type === "payment.succeeded") {
      processPaymentSucceeded(context, claimed.payment, claimed.order, delivery.deliverAtMs);
    } else processPaymentFailed(context, claimed.payment, claimed.order, delivery);
  }
  return due.length;
}
