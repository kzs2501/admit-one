/**
 * Read models: what the backend shows the outside world. Derived values — live
 * availability, a hold's status, an order's effective status — are computed here, at
 * read time, never stored. Times stay epoch milliseconds; the HTTP layer turns them
 * into ISO 8601 strings.
 */
import { getEvent, type AddOnInfo, type EventInfo } from "@/core/catalog";
import type { Seat } from "@/core/seating";
import type { Amounts } from "@/core/pricing";
import type { HoldStatus, OrderStatus, PaymentFailureCode, PaymentStatus } from "@/core/statuses";
import type { LineItem } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { availableQuantity, isHoldLive } from "./inventory";
import { resolveOrderStatus } from "./orders";
import { placeAt, type QueuePlace } from "./queue";
import type { HoldRecord, OrderRecord, PaymentRecord, QueueEntryRecord } from "./state";

export interface TierView {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  available: number;
}

/** How the event is sold; a reserved hall's layout is static content, so only its id goes out. */
export type SeatingView = { kind: "general" } | { kind: "reserved"; venueId: string };

export type EventView = Omit<EventInfo, "tiers" | "addOns" | "seating"> & {
  seating: SeatingView;
  isQueueActive: boolean;
  tiers: TierView[];
  addOns: AddOnInfo[];
};

export interface SeatView {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  tierId: string;
}

export interface TicketView {
  code: string;
  attendeeName: string;
  tierName: string;
  seat: SeatView | null;
}

export interface HoldView {
  id: string;
  eventSlug: string;
  items: LineItem[];
  createdAtMs: number;
  expiresAtMs: number;
  status: HoldStatus;
  orderId: string | null;
  seats: SeatView[];
}

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  last4: string;
  failureCode: PaymentFailureCode | null;
}

export interface OrderView {
  id: string;
  holdId: string;
  eventSlug: string;
  items: LineItem[];
  seats: SeatView[];
  attendees: { name: string; email: string }[];
  addOns: Record<string, number>;
  amounts: Amounts;
  status: OrderStatus;
  statusReason: string | null;
  tickets: TicketView[];
  payment: PaymentView | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface HoldDetailsView {
  hold: HoldView;
  event: EventView;
  order: OrderView | null;
  serverTimeMs: number;
}

export interface QueueEntryView extends QueuePlace {
  token: string;
  eventSlug: string;
  aheadAtJoin: number;
  serverTimeMs: number;
}

export const toQueueEntryView = (context: BackendContext, entry: QueueEntryRecord): QueueEntryView => {
  const nowMs = context.deps.now();
  return {
    token: entry.token,
    eventSlug: entry.eventSlug,
    aheadAtJoin: entry.aheadAtJoin,
    ...placeAt(entry, nowMs),
    serverTimeMs: nowMs,
  };
};

export interface SeatAvailabilityView {
  eventSlug: string;
  unavailableSeatIds: string[];
  serverTimeMs: number;
}

export interface PaymentResultView {
  payment: PaymentView;
  order: OrderView;
}

const toSeatView = (seat: Seat): SeatView => ({
  id: seat.id,
  sectionName: seat.sectionName,
  row: seat.rowLabel,
  number: seat.number,
  tierId: seat.tierId,
});

/** An event's seats by id, in the order given; empty for general admission. */
function seatsOf(eventSlug: string, seatIds: readonly string[]): SeatView[] {
  const { seating } = getEvent(eventSlug);
  if (seating.kind !== "reserved") return [];
  return seatIds.flatMap((seatId) => {
    const seat = seating.plan.seatsById.get(seatId);
    return seat ? [toSeatView(seat)] : [];
  });
}

export const toEventView = (context: BackendContext, event: EventInfo): EventView => ({
  slug: event.slug,
  name: event.name,
  tagline: event.tagline,
  startsAt: event.startsAt,
  timeZone: event.timeZone,
  currency: event.currency,
  venue: event.venue,
  city: event.city,
  description: event.description,
  seating:
    event.seating.kind === "reserved" ? { kind: "reserved", venueId: event.seating.plan.venueId } : { kind: "general" },
  isQueueActive: context.chaos().waitingRoom !== null,
  // Public fields only: capacity and baseline sales stay inside the backend.
  tiers: event.tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    description: tier.description,
    priceMinor: tier.priceMinor,
    available: availableQuantity(context, tier.id),
  })),
  addOns: event.addOns,
});

const toHoldView = (context: BackendContext, hold: HoldRecord): HoldView => ({
  id: hold.id,
  eventSlug: hold.eventSlug,
  items: hold.items,
  createdAtMs: hold.createdAtMs,
  expiresAtMs: hold.expiresAtMs,
  status: hold.isConverted ? "converted" : isHoldLive(hold, context.deps.now()) ? "active" : "expired",
  orderId: hold.orderId,
  seats: seatsOf(hold.eventSlug, hold.seatIds),
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
    seats: seatsOf(order.eventSlug, context.state.holds[order.holdId]?.seatIds ?? []),
    attendees: order.attendees,
    addOns: order.addOns,
    amounts: order.amounts,
    status,
    statusReason: reason,
    tickets: order.tickets.map(({ seatId, ...ticket }) => ({
      ...ticket,
      seat: seatId ? (seatsOf(order.eventSlug, [seatId])[0] ?? null) : null,
    })),
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
