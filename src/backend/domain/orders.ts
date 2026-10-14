/**
 * Orders: one per hold, created or updated as the buyer reviews, moved through the
 * order state machine, and fulfilled with tickets once paid.
 */
import { getEventInfo } from "@/core/catalog";
import type { OrderStatus } from "@/contract/dto";
import { priceOrder, ticketCount } from "@/core/money";
import { upsertOrderSchema } from "@/core/schemas";
import type { BackendContext } from "./context";
import { isHoldLive } from "./inventory";
import { assertTransition } from "./order-machine";
import { fail, ok, type Result } from "./result";
import type { OrderRecord } from "./state";

/** A payment is underway: its webhook, not the hold's clock, decides what happens next. */
export function isPaymentInFlight(context: BackendContext, order: OrderRecord): boolean {
  const payment = order.paymentId ? context.state.payments[order.paymentId] : undefined;
  return payment?.status === "processing" || payment?.status === "requires_action";
}

/**
 * An unpaid order whose hold has run out is expired — derived, not stored, so a read
 * never has to write. A payment in flight protects the order.
 */
export function resolveOrderStatus(
  context: BackendContext,
  order: OrderRecord,
): { status: OrderStatus; reason: string | null } {
  if ((order.status === "pending" || order.status === "failed") && !isPaymentInFlight(context, order)) {
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
  order.updatedAt = context.deps.now();
}

/** Persist a derived expiry when a write path runs into it. */
export function settleExpiry(context: BackendContext, order: OrderRecord) {
  const { status, reason } = resolveOrderStatus(context, order);
  if (status === "expired" && order.status !== "expired") setOrderStatus(context, order, "expired", reason);
}

/** Eight characters from an alphabet without look-alikes (no 0/O or 1/I/L). */
function createTicketCode(context: BackendContext) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(context.deps.random() * alphabet.length)]).join("");
}

export function issueTickets(context: BackendContext, order: OrderRecord) {
  const event = getEventInfo(order.eventSlug)!;
  const tierNames = order.items.flatMap(({ tierId, qty }) =>
    Array.from({ length: qty }, () => event.tiers.find((t) => t.id === tierId)?.name ?? tierId),
  );
  order.tickets = order.attendees.map((attendee, i) => ({
    code: createTicketCode(context),
    attendeeName: attendee.name,
    tierName: tierNames[i],
  }));
}

/**
 * One order per hold, so this is naturally idempotent: calling it twice updates the
 * same order instead of creating two. (Payments, which can't be keyed by anything
 * natural, use an explicit Idempotency-Key instead.)
 */
export function upsertOrder(context: BackendContext, body: unknown): Result<OrderRecord> {
  const parsed = upsertOrderSchema.safeParse(body);
  if (!parsed.success) return fail(422, "invalid_request", parsed.error.issues[0].message);
  const { holdId, attendees, addOns } = parsed.data;
  const hold = context.state.holds[holdId];
  if (!hold) return fail(404, "not_found", "That reservation doesn’t exist.");
  if (hold.converted) return fail(409, "already_completed", "This order is already complete.");

  const event = getEventInfo(hold.eventSlug)!;
  const count = ticketCount(hold.items);
  if (attendees.length !== count) return fail(422, "invalid_request", `Add details for all ${count} tickets.`);
  for (const [id, quantity] of Object.entries(addOns)) {
    if (!event.addOns.some((a) => a.id === id)) return fail(422, "invalid_request", "Unknown add-on.");
    if (quantity > count) {
      return fail(422, "invalid_request", "You can add at most one of each extra per ticket.");
    }
  }
  const chosenAddOns = Object.fromEntries(Object.entries(addOns).filter(([, quantity]) => quantity > 0));

  const nowMs = context.deps.now();
  const existing = hold.orderId ? context.state.orders[hold.orderId] : undefined;
  if (existing) {
    settleExpiry(context, existing);
    if (isPaymentInFlight(context, existing)) {
      return fail(409, "payment_in_progress", "A payment is already in progress.");
    }
    if (existing.status !== "pending" && existing.status !== "failed") {
      return existing.status === "expired"
        ? fail(410, "hold_expired", "Your reservation expired.")
        : fail(409, "already_completed", "This order can no longer be changed.");
    }
    existing.attendees = attendees;
    existing.addOns = chosenAddOns;
    existing.amounts = priceOrder(event, hold.items, chosenAddOns);
    existing.updatedAt = nowMs;
    context.log("order", `Order ${existing.id} updated.`);
    return ok(existing);
  }

  if (!isHoldLive(hold, nowMs)) return fail(410, "hold_expired", "Your reservation expired.");
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
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  context.state.orders[order.id] = order;
  hold.orderId = order.id;
  context.log("order", `Order ${order.id} created for hold ${hold.id} (pending).`);
  return ok(order, 201);
}

export function findOrder(context: BackendContext, orderId: string): Result<OrderRecord> {
  const order = context.state.orders[orderId];
  return order ? ok(order) : fail(404, "not_found", "That order doesn’t exist.");
}
