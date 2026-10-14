/**
 * Orders: one per hold, created or updated as the buyer reviews, moved through the
 * order state machine, and fulfilled with tickets once paid.
 */
import { getEvent } from "@/core/catalog";
import { priceOrder } from "@/core/money";
import type { Attendee } from "@/core/schemas";
import type { OrderStatus } from "@/core/statuses";
import { ticketCount } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";
import { isHoldLive } from "./inventory";
import { assertTransition } from "./order-machine";
import type { OrderRecord } from "./state";

const TICKET_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes: 0/O, 1/I/L
const TICKET_CODE_LENGTH = 8;

export type UpsertOrderCommand = { holdId: string; attendees: Attendee[]; addOns: Record<string, number> };

/** A payment is underway: its webhook, not the hold's clock, decides what happens next. */
export function isPaymentInFlight(context: BackendContext, order: OrderRecord): boolean {
  const payment = order.paymentId ? context.state.payments[order.paymentId] : undefined;
  return payment?.status === "processing" || payment?.status === "requires_action";
}

/** Unpaid orders can still be edited or paid; everything else is past that point. */
export const isOrderOpen = (order: OrderRecord) => order.status === "pending" || order.status === "failed";

/**
 * An unpaid order whose hold has run out is expired — derived, not stored, so a read
 * never has to write. A payment in flight protects the order.
 */
export function resolveOrderStatus(
  context: BackendContext,
  order: OrderRecord,
): { status: OrderStatus; reason: string | null } {
  if (isOrderOpen(order) && !isPaymentInFlight(context, order)) {
    const hold = context.state.holds[order.holdId];
    if (hold && !isHoldLive(hold, context.deps.now())) {
      return { status: "expired", reason: "Your reservation expired before payment was completed." };
    }
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

/** Persist a derived expiry when a write path runs into it. */
export function settleExpiry(context: BackendContext, order: OrderRecord) {
  const { status, reason } = resolveOrderStatus(context, order);
  if (status === "expired" && order.status !== "expired") setOrderStatus(context, order, "expired", reason);
}

function createTicketCode(context: BackendContext) {
  return Array.from(
    { length: TICKET_CODE_LENGTH },
    () => TICKET_CODE_ALPHABET[Math.floor(context.deps.random() * TICKET_CODE_ALPHABET.length)],
  ).join("");
}

export function issueTickets(context: BackendContext, order: OrderRecord) {
  const event = getEvent(order.eventSlug);
  // One tier name per ticket, in order: "General, General, Workshop + General".
  const tierNames = order.items.flatMap(({ tierId, quantity }) =>
    Array.from({ length: quantity }, () => event.tiers.find((tier) => tier.id === tierId)?.name ?? tierId),
  );
  order.tickets = order.attendees.map((attendee, i) => ({
    code: createTicketCode(context),
    attendeeName: attendee.name,
    tierName: tierNames[i] ?? "Ticket",
  }));
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
  const hold = context.state.holds[holdId];
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
  const order = context.state.orders[orderId];
  return order ? ok(order) : fail({ code: "not_found", detail: "That order doesn’t exist." });
}
