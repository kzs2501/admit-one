/**
 * Read models: what the backend shows the outside world. Derived values — live
 * availability, a hold's status, an order's effective status — are computed here, at
 * read time, never stored. Times stay epoch milliseconds; the HTTP layer turns them
 * into ISO 8601 strings.
 */
import { getEvent, type AddOnInfo, type EventInfo } from "@/core/catalog";
import {
  can,
  getOrganisation,
  PERMISSIONS,
  permissionsOf,
  type Account,
  type Organisation,
  type Permission,
  type Role,
} from "@/core/organisations";
import type { Seat } from "@/core/seating";
import type { Amounts } from "@/core/pricing";
import type {
  HoldStatus,
  OrderStatus,
  PaymentFailureCode,
  PaymentMethod,
  PaymentStatus,
  RefundReason,
  RefundStatus,
} from "@/core/statuses";
import type { OrderRow, OrganiserOrder } from "./reporting";
import type { LineItem } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { availableQuantity, isHoldLive } from "./inventory";
import { resolveOrderStatus, resolvePayment } from "./orders";
import { placeAt, type QueuePlace } from "./queue";
import type { HoldRecord, OrderRecord, PaymentRecord, QueueEntryRecord, RefundRecord } from "./state";
import { buildUpiIntent, UPI_PAYEE } from "./upi";

export interface TierView {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  available: number;
}

/** How the event is sold; a reserved hall's layout is static content, so only its id goes out. */
export type SeatingView = { kind: "general" } | { kind: "reserved"; venueId: string };

export type EventView = Omit<EventInfo, "tiers" | "addOns" | "seating" | "organiserId"> & {
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

/** What the buyer must do before the payment can go on. */
export type NextActionView = { type: "card_challenge" } | { type: "upi"; intentUri: string; expiresAtMs: number };

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  last4: string | null;
  failureCode: PaymentFailureCode | null;
  nextAction: NextActionView | null;
}

/** A UPI request as the buyer's phone shows it: who's asking, for how much, until when. */
export interface UpiRequestView {
  paymentId: string;
  payeeName: string;
  amountMinor: number;
  expiresAtMs: number;
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

/** Who's signed in, as the dashboard needs to know them. */
export interface AccountView {
  id: string;
  name: string;
  email: string;
  role: Role;
  organisation: Organisation;
  permissions: Permission[];
}

export interface OrganiserEventView {
  slug: string;
  name: string;
  startsAt: string;
  timeZone: string;
  currency: EventInfo["currency"];
  venue: string;
  city: string;
  /** What this account may do for this event. */
  permissions: Permission[];
}

export const toAccountView = ({ organisationId, ...account }: Account): AccountView => ({
  ...account,
  organisation: getOrganisation(organisationId),
  permissions: [...permissionsOf({ organisationId, ...account })],
});

export const toOrganiserEventView = (account: Account, event: EventInfo): OrganiserEventView => ({
  slug: event.slug,
  name: event.name,
  startsAt: event.startsAt,
  timeZone: event.timeZone,
  currency: event.currency,
  venue: event.venue,
  city: event.city,
  permissions: PERMISSIONS.filter((permission) => can(account, permission, event)),
});

/** An order as a row of the organiser's table. */
export interface OrderRowView {
  id: string;
  eventSlug: string;
  eventName: string;
  createdAtMs: number;
  buyerName: string;
  buyerEmail: string;
  ticketCount: number;
  totalMinor: number;
  currency: EventInfo["currency"];
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  refundStatus: RefundStatus | null;
}

export interface RefundView {
  id: string;
  orderId: string;
  amountMinor: number;
  currency: EventInfo["currency"];
  reason: RefundReason;
  status: RefundStatus;
  createdAtMs: number;
  settledAtMs: number | null;
}

/** What a refund shows: not who asked for it, which stays in the server log. */
export const toRefundView = (refund: RefundRecord): RefundView => ({
  id: refund.id,
  orderId: refund.orderId,
  amountMinor: refund.amountMinor,
  currency: refund.currency,
  reason: refund.reason,
  status: refund.status,
  createdAtMs: refund.createdAtMs,
  settledAtMs: refund.settledAtMs,
});

export interface OrganiserOrderView extends OrderRowView {
  items: { tierId: string; tierName: string; quantity: number }[];
  seats: SeatView[];
  addOns: { id: string; name: string; quantity: number }[];
  amounts: Amounts;
  attendees: { name: string; email: string }[];
  last4: string | null;
  refunds: RefundView[];
}

export const toOrderRowView = (row: OrderRow): OrderRowView => ({
  id: row.id,
  eventSlug: row.eventSlug,
  eventName: getEvent(row.eventSlug).name,
  createdAtMs: row.createdAtMs,
  buyerName: row.buyerName,
  buyerEmail: row.buyerEmail,
  ticketCount: row.ticketCount,
  totalMinor: row.amounts.totalMinor,
  currency: row.amounts.currency,
  status: row.status,
  paymentMethod: row.method,
  refundStatus: row.refundStatus,
});

export function toOrganiserOrderView(order: OrganiserOrder): OrganiserOrderView {
  const event = getEvent(order.eventSlug);
  const nameOf = (list: readonly { id: string; name: string }[], id: string) =>
    list.find((entry) => entry.id === id)?.name ?? id;
  return {
    ...toOrderRowView(order),
    items: order.items.map(({ tierId, quantity }) => ({ tierId, tierName: nameOf(event.tiers, tierId), quantity })),
    seats: seatsOf(order.eventSlug, order.seatIds),
    addOns: Object.entries(order.addOns).map(([id, quantity]) => ({ id, name: nameOf(event.addOns, id), quantity })),
    amounts: order.amounts,
    attendees: order.attendees,
    last4: order.last4,
    refunds: order.refunds.map(toRefundView),
  };
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

const nextActionFor = (payment: PaymentRecord): NextActionView =>
  payment.method === "upi"
    ? {
        type: "upi",
        intentUri: buildUpiIntent({
          paymentId: payment.id,
          orderId: payment.orderId,
          amountMinor: payment.amountMinor,
        }),
        expiresAtMs: payment.expiresAtMs,
      }
    : { type: "card_challenge" };

/** A payment as it stands now: an expired UPI request reads as failed before anything writes it down. */
export function toPaymentView(context: BackendContext, payment: PaymentRecord): PaymentView {
  const { status, failureCode } = resolvePayment(context, payment);
  return {
    id: payment.id,
    method: payment.method,
    status,
    last4: payment.method === "card" ? payment.last4 : null,
    failureCode,
    nextAction: status === "requires_action" ? nextActionFor(payment) : null,
  };
}

export const toUpiRequestView = (payment: PaymentRecord & { method: "upi" }): UpiRequestView => ({
  paymentId: payment.id,
  payeeName: UPI_PAYEE.name,
  amountMinor: payment.amountMinor,
  expiresAtMs: payment.expiresAtMs,
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
    payment: payment ? toPaymentView(context, payment) : null,
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
