/**
 * Inventory: holds and availability. Expiry is lazy — an expired hold simply stops
 * counting. Nothing runs on a timer to "release" it, so there's no window where a
 * dead hold still blocks a buyer, and reads never write.
 */
import { catalog, findTier, getEventInfo } from "@/core/catalog";
import { createHoldSchema } from "@/core/schemas";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./result";
import type { HoldRecord } from "./state";

export const isHoldLive = (hold: HoldRecord, nowMs: number) => !hold.converted && nowMs < hold.expiresAt;

/** capacity − baseline sold − sold here − tickets in live holds. */
export function availableQuantity(context: BackendContext, tierId: string): number {
  const found = findTier(tierId);
  if (!found) return 0;
  const nowMs = context.deps.now();
  let held = 0;
  for (const hold of Object.values(context.state.holds)) {
    if (!isHoldLive(hold, nowMs)) continue;
    for (const item of hold.items) if (item.tierId === tierId) held += item.qty;
  }
  const { tier } = found;
  return Math.max(0, tier.capacity - tier.baselineSold - (context.state.sold[tierId] ?? 0) - held);
}

/** The crowd buys tickets outright (no checkout of their own). */
function crowdBuys(context: BackendContext, tierId: string, quantity: number, why: string) {
  context.state.sold[tierId] = (context.state.sold[tierId] ?? 0) + quantity;
  context.log("crowd", `Another buyer took ${quantity} × ${findTier(tierId)?.tier.name} (${why}).`);
}

export function createHold(context: BackendContext, body: unknown): Result<HoldRecord> {
  const parsed = createHoldSchema.safeParse(body);
  if (!parsed.success) return fail(422, "invalid_request", parsed.error.issues[0].message);
  const { eventSlug, items } = parsed.data;
  const event = getEventInfo(eventSlug);
  if (!event) return fail(404, "not_found", "No such event.");
  for (const { tierId } of items) {
    if (!event.tiers.some((t) => t.id === tierId)) return fail(422, "invalid_request", "Unknown ticket type.");
  }

  // The crowd snipes nearly-sold-out tiers a moment before the visitor's request.
  if (context.chaos().crowd) {
    for (const { tierId } of items) {
      const left = availableQuantity(context, tierId);
      if (left > 0 && left <= 2) crowdBuys(context, tierId, left, "a moment before you");
    }
  }

  // In a real database this check and the insert below would be one transaction (or
  // a conditional update), so two buyers can't both pass it. Here the backend is
  // single-threaded, which makes it atomic by construction.
  for (const { tierId, qty } of items) {
    const left = availableQuantity(context, tierId);
    if (left < qty) {
      return fail(
        409,
        "sold_out",
        left === 0 ? "Those tickets just sold out." : `Only ${left} left for that ticket type.`,
        { tierId, available: left },
      );
    }
  }

  const nowMs = context.deps.now();
  const hold: HoldRecord = {
    id: context.deps.newId("hold"),
    eventSlug,
    items,
    createdAt: nowMs,
    expiresAt: nowMs + context.chaos().holdSeconds * 1000,
    converted: false,
    extended: false,
    orderId: null,
  };
  context.state.holds[hold.id] = hold;
  context.log(
    "hold",
    `Hold ${hold.id} created: ${items.map((i) => `${i.qty} × ${findTier(i.tierId)?.tier.name}`).join(", ")}.`,
  );
  return ok(hold, 201);
}

export function findHold(context: BackendContext, holdId: string): Result<HoldRecord> {
  const hold = context.state.holds[holdId];
  return hold ? ok(hold) : fail(404, "not_found", "That reservation doesn’t exist.");
}

/** Background buying, so availability visibly moves while the crowd preset is on. */
export function crowdTick(context: BackendContext): boolean {
  if (!context.chaos().crowd) return false;
  const candidates = catalog.flatMap((e) => e.tiers).filter((t) => availableQuantity(context, t.id) > 3);
  if (!candidates.length) return false;
  const tier = candidates[Math.floor(context.deps.random() * candidates.length)];
  crowdBuys(context, tier.id, 1, "in the background");
  return true;
}
