/**
 * Inventory: holds and availability. Expiry is lazy — an expired hold simply stops
 * counting. Nothing runs on a timer to "release" it, so there's no window where a
 * dead hold still blocks a buyer, and reads never write.
 */
import { CATALOG, findEvent, findTier } from "@/core/catalog";
import type { LineItem } from "@/core/ticketing";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";
import type { HoldRecord } from "./state";

/** A crowd buyer snipes a tier once this few tickets are left. */
const CROWD_SNIPE_AT_MOST = 2;
/** The background crowd only buys from tiers with more than this many left. */
const CROWD_BACKGROUND_ABOVE = 3;

export interface CreateHoldCommand {
  eventSlug: string;
  items: LineItem[];
}

export const isHoldLive = (hold: HoldRecord, nowMs: number) => !hold.isConverted && nowMs < hold.expiresAtMs;

/** capacity − baseline sold − sold here − tickets in live holds. */
export function availableQuantity(context: BackendContext, tierId: string): number {
  const found = findTier(tierId);
  if (!found) return 0;
  const nowMs = context.deps.now();
  let heldQuantity = 0;
  for (const hold of Object.values(context.state.holds)) {
    if (!isHoldLive(hold, nowMs)) continue;
    for (const item of hold.items) if (item.tierId === tierId) heldQuantity += item.quantity;
  }
  const { tier } = found;
  return Math.max(0, tier.capacity - tier.baselineSold - (context.state.sold[tierId] ?? 0) - heldQuantity);
}

/** The crowd buys tickets outright (no checkout of their own). */
function recordCrowdPurchase(context: BackendContext, tierId: string, quantity: number, why: string) {
  context.state.sold[tierId] = (context.state.sold[tierId] ?? 0) + quantity;
  context.log("crowd", `Another buyer took ${quantity} × ${findTier(tierId)?.tier.name ?? tierId} (${why}).`);
}

export function createHold(context: BackendContext, { eventSlug, items }: CreateHoldCommand): Result<HoldRecord> {
  const event = findEvent(eventSlug);
  if (!event) return fail({ code: "not_found", detail: "No such event." });
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

  // In a real database this check and the insert below would be one transaction (or
  // a conditional update), so two buyers can't both pass it. Here the backend is
  // single-threaded, which makes it atomic by construction.
  for (const { tierId, quantity } of items) {
    const left = availableQuantity(context, tierId);
    if (left < quantity) {
      return fail({
        code: "sold_out",
        detail: left === 0 ? "Those tickets just sold out." : `Only ${left} left for that ticket type.`,
        tierId,
        available: left,
      });
    }
  }

  const nowMs = context.deps.now();
  const hold: HoldRecord = {
    id: context.deps.newId("hold"),
    eventSlug,
    items,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + context.chaos().holdDurationMs,
    isConverted: false,
    isExtended: false,
    orderId: null,
  };
  context.state.holds[hold.id] = hold;
  const summary = items.map((item) => `${item.quantity} × ${findTier(item.tierId)?.tier.name ?? item.tierId}`);
  context.log("hold", `Hold ${hold.id} created: ${summary.join(", ")}.`);
  return ok(hold);
}

export function findHold(context: BackendContext, holdId: string): Result<HoldRecord> {
  const hold = context.state.holds[holdId];
  return hold ? ok(hold) : fail({ code: "not_found", detail: "That reservation doesn’t exist." });
}

/** Background buying, so availability visibly moves while the crowd preset is on. */
export function runCrowdTick(context: BackendContext): boolean {
  if (!context.chaos().isCrowdEnabled) return false;
  const candidates = CATALOG.flatMap((event) => event.tiers).filter(
    (tier) => availableQuantity(context, tier.id) > CROWD_BACKGROUND_ABOVE,
  );
  const tier = candidates[Math.floor(context.deps.random() * candidates.length)];
  if (!tier) return false;
  recordCrowdPurchase(context, tier.id, 1, "in the background");
  return true;
}
