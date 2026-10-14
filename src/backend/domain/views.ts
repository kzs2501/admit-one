/**
 * Read models: what the backend shows the outside world. Derived values — live
 * availability, a hold's status, an order's effective status — are computed here, at
 * read time, never stored. Times stay epoch milliseconds; the HTTP layer turns them
 * into ISO 8601 strings.
 */
import { getEvent, type AddOnInfo, type EventInfo } from "@/core/catalog";
import type { Amounts } from "@/core/money";
import type { HoldStatus, OrderStatus, PaymentFailureCode, PaymentStatus } from "@/core/statuses";
import type { LineItem } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { availableQuantity, isHoldLive } from "./inventory";
import { resolveOrderStatus } from "./orders";
import type { HoldRecord, OrderRecord, PaymentRecord } from "./state";

export type TierView = { id: string; name: string; description: string; priceCents: number; available: number };

export type EventView = Omit<EventInfo, "tiers" | "addOns"> & { tiers: TierView[]; addOns: AddOnInfo[] };

export type HoldView = {
  id: string;
  eventSlug: string;
  items: LineItem[];
  createdAtMs: number;
  expiresAtMs: number;
  status: HoldStatus;
  orderId: string | null;
};

export type PaymentView = {
  id: string;
  status: PaymentStatus;
  last4: string;
  failureCode: PaymentFailureCode | null;
};

export type OrderView = {
  id: string;
  holdId: string;
  eventSlug: string;
  items: LineItem[];
  attendees: { name: string; email: string }[];
  addOns: Record<string, number>;
  amounts: Amounts;
  status: OrderStatus;
  statusReason: string | null;
  tickets: { code: string; attendeeName: string; tierName: string }[];
  payment: PaymentView | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HoldDetailsView = { hold: HoldView; event: EventView; order: OrderView | null; serverTimeMs: number };

export type PaymentResultView = { payment: PaymentView; order: OrderView };

export const toEventView = (context: BackendContext, event: EventInfo): EventView => ({
  slug: event.slug,
  name: event.name,
  tagline: event.tagline,
  startsAt: event.startsAt,
  venue: event.venue,
  city: event.city,
  description: event.description,
  // Public fields only: capacity and baseline sales stay inside the backend.
  tiers: event.tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    description: tier.description,
    priceCents: tier.priceCents,
    available: availableQuantity(context, tier.id),
  })),
  addOns: event.addOns,
});

export const toHoldView = (context: BackendContext, hold: HoldRecord): HoldView => ({
  id: hold.id,
  eventSlug: hold.eventSlug,
  items: hold.items,
  createdAtMs: hold.createdAtMs,
  expiresAtMs: hold.expiresAtMs,
  status: hold.isConverted ? "converted" : isHoldLive(hold, context.deps.now()) ? "active" : "expired",
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
    createdAtMs: order.createdAtMs,
    updatedAtMs: order.updatedAtMs,
  };
}

export function toHoldDetailsView(context: BackendContext, hold: HoldRecord): HoldDetailsView {
  const order = hold.orderId ? context.state.orders[hold.orderId] : undefined;
  return {
    hold: toHoldView(context, hold),
    event: toEventView(context, getEvent(hold.eventSlug)),
    order: order ? toOrderView(context, order) : null,
    serverTimeMs: context.deps.now(),
  };
}
