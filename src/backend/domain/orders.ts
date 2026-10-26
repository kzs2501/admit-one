/**
 * Orders: one per hold, created or updated as the buyer reviews, moved through the
 * order state machine, and fulfilled with tickets once paid.
 */
import { own } from "./state";
import { getEvent } from "@/core/catalog";
import { seatLabel } from "@/core/seating";
import { priceOrder } from "@/core/pricing";
import type { Attendee } from "@/core/schemas";
import type { OrderStatus, PaymentFailureCode, PaymentStatus } from "@/core/statuses";
import { ticketCount } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";
import { isHoldLive } from "./inventory";
import { assertTransition } from "./order-machine";
import type { OrderRecord, PaymentRecord } from "./state";
import { isUpiRequestExpired } from "./upi";

const TICKET_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes: 0/O, 1/I/L
const TICKET_CODE_LENGTH = 8;

export interface UpsertOrderCommand {
  holdId: string;
  attendees: Attendee[];
  addOns: Record<string, number>;
}

const UPI_EXPIRED_REASON = "Nobody approved the UPI request before it ran out.";
const CHECKOUT_EXPIRED_REASON = "The payment window closed before anything was paid. No money was taken.";

/**
 * A payment waiting on the buyer — a UPI request, an open checkout — that ran out with
 * nothing paid: how it failed, and why in words. Null if it hasn't. Like a hold's
 * expiry, it's worked out when read, and written down by the next command.
 */
function lapsedRequest(payment: PaymentRecord, nowMs: number) {
  if (isUpiRequestExpired(payment, nowMs)) return { failureCode: "upi_expired" as const, reason: UPI_EXPIRED_REASON };
  if (payment.method === "razorpay" && payment.status === "requires_action" && nowMs >= payment.expiresAtMs) {
    return { failureCode: "checkout_expired" as const, reason: CHECKOUT_EXPIRED_REASON };
  }
  return null;
}

/** A payment as it stands now: a request nobody paid in time has failed, though nothing has written that down yet. */
export function resolvePayment(
  context: BackendContext,
  payment: PaymentRecord,
): { status: PaymentStatus; failureCode: PaymentFailureCode | null } {
  const lapsed = lapsedRequest(payment, context.deps.now());
  return lapsed
    ? { status: "failed", failureCode: lapsed.failureCode }
    : { status: payment.status, failureCode: payment.failureCode };
}

const paymentOf = (context: BackendContext, order: OrderRecord) =>
  order.paymentId ? context.state.payments[order.paymentId] : undefined;

/** A payment is underway: its webhook, not the hold's clock, decides what happens next. */
export function isPaymentInFlight(context: BackendContext, order: OrderRecord): boolean {
  const payment = paymentOf(context, order);
  if (!payment) return false;
  const { status } = resolvePayment(context, payment);
  return status === "processing" || status === "requires_action";
}

/** Unpaid orders can still be edited or paid; everything else is past that point. */
export const isOrderOpen = (order: OrderRecord) => order.status === "pending" || order.status === "failed";

/**
 * An unpaid order whose hold has run out is expired, and one whose UPI request ran out
 * has failed — derived, not stored, so a read never has to write. A payment in flight
 * protects the order.
 */
export function resolveOrderStatus(
  context: BackendContext,
  order: OrderRecord,
): { status: OrderStatus; reason: string | null } {
  if (isOrderOpen(order) && !isPaymentInFlight(context, order)) {
    const nowMs = context.deps.now();
    const hold = context.state.holds[order.holdId];
    if (hold && !isHoldLive(hold, nowMs)) {
      return { status: "expired", reason: "Your reservation expired before payment was completed." };
    }
    const payment = paymentOf(context, order);
    const lapsed = order.status === "pending" && payment ? lapsedRequest(payment, nowMs) : null;
    if (lapsed) return { status: "failed", reason: lapsed.reason };
  }
  return { status: order.status, reason: order.statusReason };
}

export function setOrderStatus(
  context: BackendContext,
  order: OrderRecord,
  to: OrderStatus,
  reason: string | null = null,
) {
  assertTransition(order.status, to);
  context.log("order", `Order ${order.id}: ${order.status} → ${to}${reason ? ` (${reason})` : ""}.`);
  order.status = to;
  order.statusReason = reason;
  order.updatedAtMs = context.deps.now();
}

/** Persist a derived expiry — the hold's, or a UPI request's — when a write path runs into it. */
export function settleExpiry(context: BackendContext, order: OrderRecord) {
  const { status, reason } = resolveOrderStatus(context, order);
  const payment = paymentOf(context, order);
  const lapsed = payment ? lapsedRequest(payment, context.deps.now()) : null;
  if (payment && lapsed) {
    payment.status = "failed";
    payment.failureCode = lapsed.failureCode;
    context.log("payment", `Payment ${payment.id} ran out unpaid.`);
  }
  if (status !== order.status) setOrderStatus(context, order, status, reason);
}

function createTicketCode(context: BackendContext) {
  return Array.from(
    { length: TICKET_CODE_LENGTH },
    () => TICKET_CODE_ALPHABET[Math.floor(context.deps.random() * TICKET_CODE_ALPHABET.length)],
  ).join("");
}

export function issueTickets(context: BackendContext, order: OrderRecord) {
  const event = getEvent(order.eventSlug);
  const tierName = (tierId: string) => event.tiers.find((tier) => tier.id === tierId)?.name ?? tierId;
  // Reserved seating: one seat per attendee, in hall order, each with its own tier.
  const seatIds = context.state.holds[order.holdId]?.seatIds ?? [];
  const { seating } = event;
  const seatTierIds = seating.kind === "reserved" ? seatIds.map((id) => seating.plan.seatsById.get(id)?.tierId) : [];
  // Otherwise one tier name per ticket, in order: "General, General, Workshop + General".
  const tierIds = order.items.flatMap(({ tierId, quantity }) => Array.from({ length: quantity }, () => tierId));
  order.tickets = order.attendees.map((attendee, i) => {
    const tierId = seatTierIds[i] ?? tierIds[i];
    const seatId = seatIds[i] ?? null;
    const seat = seatId && seating.kind === "reserved" ? seating.plan.seatsById.get(seatId) : undefined;
    const ticket = {
      code: createTicketCode(context),
      attendeeName: attendee.name,
      tierName: tierId ? tierName(tierId) : "Ticket",
      seatId,
    };
    // Signed as it's issued: the token is the ticket, as far as the door is concerned.
    const token = context.deps.signTicket({
      code: ticket.code,
      eventSlug: order.eventSlug,
      attendeeName: ticket.attendeeName,
      tierName: ticket.tierName,
      seat: seat ? seatLabel(seat) : null,
    });
    return { ...ticket, token };
  });
}

/**
 * One order per hold, so this is naturally idempotent: calling it twice updates the
 * same order instead of creating two. (Payments, which can't be keyed by anything
 * natural, use an explicit Idempotency-Key instead.)
 */
export function upsertOrder(
  context: BackendContext,
  { holdId, attendees, addOns }: UpsertOrderCommand,
): Result<{ order: OrderRecord; isCreated: boolean }> {
  const hold = own(context.state.holds, holdId);
  if (!hold) return fail({ code: "not_found", detail: "That reservation doesn’t exist." });
  if (hold.isConverted) return fail({ code: "already_completed", detail: "This order is already complete." });

  const event = getEvent(hold.eventSlug);
  const count = ticketCount(hold.items);
  if (attendees.length !== count) {
    return fail({ code: "invalid_request", detail: `Add details for all ${count} tickets.` });
  }
  for (const [addOnId, quantity] of Object.entries(addOns)) {
    if (!event.addOns.some((addOn) => addOn.id === addOnId)) {
      return fail({ code: "invalid_request", detail: "Unknown add-on." });
    }
    if (quantity > count) {
      return fail({ code: "invalid_request", detail: "You can add at most one of each extra per ticket." });
    }
  }
  const chosenAddOns = Object.fromEntries(Object.entries(addOns).filter(([, quantity]) => quantity > 0));

  const nowMs = context.deps.now();
  const existing = hold.orderId ? context.state.orders[hold.orderId] : undefined;
  if (existing) {
    settleExpiry(context, existing);
    if (isPaymentInFlight(context, existing)) {
      return fail({ code: "payment_in_progress", detail: "A payment is already in progress." });
    }
    if (!isOrderOpen(existing)) {
      return existing.status === "expired"
        ? fail({ code: "hold_expired", detail: "Your reservation expired." })
        : fail({ code: "already_completed", detail: "This order can no longer be changed." });
    }
    existing.attendees = attendees;
    existing.addOns = chosenAddOns;
    existing.amounts = priceOrder(event, hold.items, chosenAddOns);
    existing.updatedAtMs = nowMs;
    context.log("order", `Order ${existing.id} updated.`);
    return ok({ order: existing, isCreated: false });
  }

  if (!isHoldLive(hold, nowMs)) return fail({ code: "hold_expired", detail: "Your reservation expired." });
  const order: OrderRecord = {
    id: context.deps.newId("ord"),
    holdId,
    eventSlug: hold.eventSlug,
    items: hold.items,
    attendees,
    addOns: chosenAddOns,
    amounts: priceOrder(event, hold.items, chosenAddOns),
    status: "pending",
    statusReason: null,
    tickets: [],
    paymentId: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  context.state.orders[order.id] = order;
  hold.orderId = order.id;
  context.log("order", `Order ${order.id} created for hold ${hold.id} (pending).`);
  return ok({ order, isCreated: true });
}

export function findOrder(context: BackendContext, orderId: string): Result<OrderRecord> {
  const order = own(context.state.orders, orderId);
  return order ? ok(order) : fail({ code: "not_found", detail: "That order doesn’t exist." });
}
