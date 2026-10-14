/**
 * Read models: what the backend shows the outside world. Derived values — live
 * availability, a hold's status, an order's effective status — are computed here, at
 * read time, never stored.
 */
import { getEventInfo, type EventInfo } from "@/core/catalog";
import type { EventView, HoldResponse, HoldView, OrderView, PaymentView } from "@/contract/dto";
import type { BackendContext } from "./context";
import { availableQuantity, isHoldLive } from "./inventory";
import { resolveOrderStatus } from "./orders";
import type { HoldRecord, OrderRecord, PaymentRecord } from "./state";

export const toEventView = (context: BackendContext, event: EventInfo): EventView => ({
  ...event,
  tiers: event.tiers.map((tier) => ({ ...tier, available: availableQuantity(context, tier.id) })),
});

export const toHoldView = (context: BackendContext, hold: HoldRecord): HoldView => ({
  id: hold.id,
  eventSlug: hold.eventSlug,
  items: hold.items,
  createdAt: hold.createdAt,
  expiresAt: hold.expiresAt,
  status: hold.converted ? "converted" : isHoldLive(hold, context.deps.now()) ? "active" : "expired",
  orderId: hold.orderId,
});

export const toPaymentView = (payment: PaymentRecord): PaymentView => ({
  id: payment.id,
  status: payment.status,
  last4: payment.last4,
  failureCode: payment.failureCode,
});

export function toOrderView(context: BackendContext, order: OrderRecord): OrderView {
  const { status, reason } = resolveOrderStatus(context, order);
  const payment = order.paymentId ? context.state.payments[order.paymentId] : undefined;
  return {
    id: order.id,
    holdId: order.holdId,
    eventSlug: order.eventSlug,
    items: order.items,
    attendees: order.attendees,
    addOns: order.addOns,
    amounts: order.amounts,
    status,
    statusReason: reason,
    tickets: order.tickets,
    payment: payment ? toPaymentView(payment) : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** A hold with its event and order, plus the server's clock so the client can correct for skew. */
export function toHoldResponse(context: BackendContext, hold: HoldRecord): HoldResponse {
  const order = hold.orderId ? context.state.orders[hold.orderId] : undefined;
  return {
    hold: toHoldView(context, hold),
    event: toEventView(context, getEventInfo(hold.eventSlug)!),
    order: order ? toOrderView(context, order) : null,
    serverNow: context.deps.now(),
  };
}
