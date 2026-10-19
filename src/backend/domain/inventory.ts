/**
 * Inventory: holds and availability — of tiers, and for reserved seating, of seats.
 * Expiry is lazy: an expired hold simply stops counting. Nothing runs on a timer to
 * "release" it, so there's no window where a dead hold still blocks a buyer, and
 * reads never write.
 */
import { CATALOG, findEvent, findTier, type EventInfo } from "@/core/catalog";
import { findSingleSeatGaps, formatSeatList, seatLabel, type Seat } from "@/core/seating";
import type { LineItem } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { fail, ok, type DomainError, type Result } from "./errors";
import { admissionProblem } from "./queue";
import { chooseBestSeats, freeSeatsInTier, isReservedEvent, type ReservedEvent } from "./seating";
import type { HoldRecord } from "./state";

/** A crowd buyer snipes a tier once this few tickets are left. */
const CROWD_SNIPE_AT_MOST = 2;
/** The background crowd only buys from tiers with more than this many left. */
const CROWD_BACKGROUND_ABOVE = 3;

/**
 * By tier ("two Premium"), or — for reserved seating — particular seats. In a sale with
 * a waiting room, the visitor's place in the queue comes too.
 */
export type CreateHoldCommand = (
  { eventSlug: string; items: LineItem[] } | { eventSlug: string; seatIds: string[] }
) & {
  queueToken?: string | null;
};

export const isHoldLive = (hold: HoldRecord, nowMs: number) => !hold.isConverted && nowMs < hold.expiresAtMs;

/** Seats sold before the sandbox that are still sold: refunds put some back on sale. */
function stillSoldBaseline(context: BackendContext, baselineSoldSeatIds: ReadonlySet<string>) {
  const released = new Set(context.state.releasedSeatIds);
  return [...baselineSoldSeatIds].filter((seatId) => !released.has(seatId));
}

/** A hall's seats that are gone: sold before the sandbox (and not refunded), sold here, or in a live hold. */
export function unavailableSeatIds(context: BackendContext, event: ReservedEvent): Set<string> {
  const { plan, baselineSoldSeatIds } = event.seating;
  const unavailable = new Set(stillSoldBaseline(context, baselineSoldSeatIds));
  for (const seatId of context.state.soldSeatIds) if (plan.seatsById.has(seatId)) unavailable.add(seatId);
  const nowMs = context.deps.now();
  for (const hold of Object.values(context.state.holds)) {
    if (hold.eventSlug !== event.slug || !isHoldLive(hold, nowMs)) continue;
    for (const seatId of hold.seatIds) unavailable.add(seatId);
  }
  return unavailable;
}

/** Tickets left in a tier: its free seats, or capacity − baseline sold − sold here − tickets in live holds. */
export function availableQuantity(context: BackendContext, tierId: string): number {
  const found = findTier(tierId);
  if (!found) return 0;
  const { event, tier } = found;
  if (isReservedEvent(event)) {
    return freeSeatsInTier(event.seating.plan, unavailableSeatIds(context, event), tierId).length;
  }
  const nowMs = context.deps.now();
  let heldQuantity = 0;
  for (const hold of Object.values(context.state.holds)) {
    if (!isHoldLive(hold, nowMs)) continue;
    for (const item of hold.items) if (item.tierId === tierId) heldQuantity += item.quantity;
  }
  const { sold, returnedTickets } = context.state;
  const soldBefore = tier.baselineSold - (returnedTickets[tierId] ?? 0);
  return Math.max(0, tier.capacity - soldBefore - (sold[tierId] ?? 0) - heldQuantity);
}

/** Tickets sold in a tier: before the sandbox, and in it — by buyers, and by the crowd. */
export function soldQuantity(context: BackendContext, tierId: string): number {
  const found = findTier(tierId);
  if (!found) return 0;
  const { event, tier } = found;
  if (isReservedEvent(event)) {
    const { plan, baselineSoldSeatIds } = event.seating;
    const sold = new Set([...stillSoldBaseline(context, baselineSoldSeatIds), ...context.state.soldSeatIds]);
    return plan.seats.filter((seat) => seat.tierId === tierId && sold.has(seat.id)).length;
  }
  return tier.baselineSold - (context.state.returnedTickets[tierId] ?? 0) + (context.state.sold[tierId] ?? 0);
}

/**
 * Put a refunded order's tickets back on sale: its seats, or its quantities. Tickets
 * from before the sandbox are recorded as returned; the sandbox's own come off its sales.
 */
export function returnToSale(
  context: BackendContext,
  { items, seatIds, isFromHistory }: { items: readonly LineItem[]; seatIds: readonly string[]; isFromHistory: boolean },
) {
  const { state } = context;
  if (seatIds.length) {
    if (isFromHistory) state.releasedSeatIds.push(...seatIds);
    else state.soldSeatIds = state.soldSeatIds.filter((seatId) => !seatIds.includes(seatId));
    return;
  }
  for (const { tierId, quantity } of items) {
    if (isFromHistory) state.returnedTickets[tierId] = (state.returnedTickets[tierId] ?? 0) + quantity;
    else state.sold[tierId] = Math.max(0, (state.sold[tierId] ?? 0) - quantity);
  }
}

/** "Stalls, row F, seat 12", or "Stalls F12–F13" for more than one. */
function describeSeats(seats: readonly Seat[]) {
  const [first] = seats;
  return first && seats.length === 1 ? seatLabel(first) : formatSeatList(seats);
}

/** Other buyers' sales stop here, so a long session can't fill the sandbox's storage. */
export const LIVE_SALES_LIMIT = 5_000;

/** Another buyer's sale, as an order the organiser will see. */
function recordLiveSale(context: BackendContext, tierId: string, quantity: number, seatIds: readonly string[]) {
  const { liveSales } = context.state;
  liveSales.push({
    seq: (liveSales.at(-1)?.seq ?? 0) + 1,
    tierId,
    quantity,
    seatIds: [...seatIds],
    atMs: context.deps.now(),
  });
}

function sellSeatsToCrowd(context: BackendContext, seats: readonly Seat[], why: string) {
  const [first] = seats;
  if (!first) return;
  context.state.soldSeatIds.push(...seats.map((seat) => seat.id));
  recordLiveSale(
    context,
    first.tierId,
    seats.length,
    seats.map((seat) => seat.id),
  );
  context.log("crowd", `Another buyer took ${describeSeats(seats)} (${why}).`);
}

/** The crowd buys outright (no checkout of their own) — the best seats left, for reserved seating. */
function recordCrowdPurchase(context: BackendContext, tierId: string, quantity: number, why: string) {
  const found = findTier(tierId);
  if (!found) return;
  const { event, tier } = found;
  if (isReservedEvent(event)) {
    const unavailable = unavailableSeatIds(context, event);
    sellSeatsToCrowd(context, chooseBestSeats(event.seating.plan, unavailable, tierId, quantity) ?? [], why);
    return;
  }
  context.state.sold[tierId] = (context.state.sold[tierId] ?? 0) + quantity;
  recordLiveSale(context, tierId, quantity, []);
  context.log("crowd", `Another buyer took ${quantity} × ${tier.name} (${why}).`);
}

const soldOut = (tierId: string, left: number): DomainError => ({
  code: "sold_out",
  detail: left === 0 ? "Those tickets just sold out." : `Only ${left} left for that ticket type.`,
  tierId,
  available: left,
});

function insertHold(context: BackendContext, eventSlug: string, items: LineItem[], seats: readonly Seat[]) {
  const nowMs = context.deps.now();
  const hold: HoldRecord = {
    id: context.deps.newId("hold"),
    eventSlug,
    items,
    seatIds: seats.map((seat) => seat.id),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + context.chaos().holdDurationMs,
    isConverted: false,
    isExtended: false,
    orderId: null,
  };
  context.state.holds[hold.id] = hold;
  const summary = items.map((item) => `${item.quantity} × ${findTier(item.tierId)?.tier.name ?? item.tierId}`);
  const seatSummary = seats.length > 0 ? ` (${formatSeatList(seats)})` : "";
  context.log("hold", `Hold ${hold.id} created: ${summary.join(", ")}${seatSummary}.`);
  return hold;
}

/** "Two Premium": the server checks availability — and for reserved seating, chooses the seats. */
function holdByTiers(context: BackendContext, event: EventInfo, items: LineItem[]): Result<HoldRecord> {
  if (items.some(({ tierId }) => !event.tiers.some((tier) => tier.id === tierId))) {
    return fail({ code: "invalid_request", detail: "Unknown ticket type." });
  }

  // The crowd snipes nearly-sold-out tiers a moment before the visitor's request.
  if (context.chaos().isCrowdEnabled) {
    for (const { tierId } of items) {
      const left = availableQuantity(context, tierId);
      if (left > 0 && left <= CROWD_SNIPE_AT_MOST) recordCrowdPurchase(context, tierId, left, "a moment before you");
    }
  }

  // In a real database, the checks below and the insert would be one transaction (or
  // a conditional update), so two buyers can't both pass them. Here the backend is
  // single-threaded, which makes them atomic by construction.
  if (isReservedEvent(event)) {
    const unavailable = unavailableSeatIds(context, event);
    const seats: Seat[] = [];
    for (const { tierId, quantity } of items) {
      const chosen = chooseBestSeats(event.seating.plan, unavailable, tierId, quantity);
      if (!chosen) return fail(soldOut(tierId, freeSeatsInTier(event.seating.plan, unavailable, tierId).length));
      for (const seat of chosen) unavailable.add(seat.id);
      seats.push(...chosen);
    }
    return ok(insertHold(context, event.slug, items, seats));
  }

  for (const { tierId, quantity } of items) {
    const left = availableQuantity(context, tierId);
    if (left < quantity) return fail(soldOut(tierId, left));
  }
  return ok(insertHold(context, event.slug, items, []));
}

/** Particular seats: all of them, or none — a buyer never ends up holding seats they didn't choose. */
function holdSeats(context: BackendContext, event: EventInfo, seatIds: string[]): Result<HoldRecord> {
  if (!isReservedEvent(event)) {
    return fail({ code: "invalid_request", detail: "This event has no reserved seats; choose tickets by type." });
  }
  const { plan } = event.seating;
  const seats = plan.seats.filter((seat) => seatIds.includes(seat.id)); // in hall order: how tickets are handed out
  if (seats.length !== seatIds.length) {
    return fail({ code: "invalid_request", detail: "One of those seats isn’t in this hall." });
  }

  // The "seat snatched" preset: someone else gets one of these seats a moment first — once.
  const snatchTarget = seats.at(-1);
  if (context.chaos().shouldSnatchRequestedSeat && !context.state.hasSnatchedSeat && snatchTarget) {
    context.state.hasSnatchedSeat = true;
    sellSeatsToCrowd(context, [snatchTarget], "a moment before you");
  }

  const unavailable = unavailableSeatIds(context, event);
  const taken = seats.filter((seat) => unavailable.has(seat.id));
  if (taken.length > 0) {
    return fail({
      code: "seats_unavailable",
      detail: `${describeSeats(taken)} ${taken.length === 1 ? "was" : "were"} just taken. Nothing was held; choose again.`,
      seatIds: taken.map((seat) => seat.id),
    });
  }
  const gaps = findSingleSeatGaps(plan, unavailable, new Set(seatIds));
  if (gaps.length > 0) {
    return fail({
      code: "single_seat_gap",
      detail: `That would leave ${describeSeats(gaps)} empty on ${gaps.length === 1 ? "its" : "their"} own. Move your selection over by one seat.`,
      seatIds: gaps.map((seat) => seat.id),
    });
  }

  const items = event.tiers.flatMap((tier) => {
    const quantity = seats.filter((seat) => seat.tierId === tier.id).length;
    return quantity > 0 ? [{ tierId: tier.id, quantity }] : [];
  });
  return ok(insertHold(context, event.slug, items, seats));
}

export function createHold(context: BackendContext, command: CreateHoldCommand): Result<HoldRecord> {
  const event = findEvent(command.eventSlug);
  if (!event) return fail({ code: "not_found", detail: "No such event." });
  const notYourTurn = admissionProblem(context, event.slug, command.queueToken ?? null);
  if (notYourTurn) {
    context.log("queue", `Hold refused for ${event.name}: ${notYourTurn.detail}`);
    return fail(notYourTurn);
  }
  return "seatIds" in command ? holdSeats(context, event, command.seatIds) : holdByTiers(context, event, command.items);
}

export function findHold(context: BackendContext, holdId: string): Result<HoldRecord> {
  const hold = context.state.holds[holdId];
  return hold ? ok(hold) : fail({ code: "not_found", detail: "That reservation doesn’t exist." });
}

/** Seats that are gone, for the map. */
export function findSeatAvailability(context: BackendContext, eventSlug: string): Result<string[]> {
  const event = findEvent(eventSlug);
  if (!event) return fail({ code: "not_found", detail: "No such event." });
  if (!isReservedEvent(event)) return fail({ code: "not_found", detail: "This event has no reserved seats." });
  return ok([...unavailableSeatIds(context, event)]);
}

/** Background buying, so availability visibly moves while the crowd preset is on. */
export function runCrowdTick(context: BackendContext): boolean {
  if (!context.chaos().isCrowdEnabled || context.state.liveSales.length >= LIVE_SALES_LIMIT) return false;
  const candidates = CATALOG.flatMap((event) => event.tiers).filter(
    (tier) => availableQuantity(context, tier.id) > CROWD_BACKGROUND_ABOVE,
  );
  const tier = candidates[Math.floor(context.deps.random() * candidates.length)];
  if (!tier) return false;
  recordCrowdPurchase(context, tier.id, 1, "in the background");
  return true;
}
