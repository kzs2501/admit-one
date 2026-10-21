/**
 * What the server starts from: the catalogue's stock and the seats sold before the
 * demo, the same starting point as the sandbox's (`core/catalog`).
 */
import { CATALOG } from "@/core/catalog";
import type { Database } from "./db";
import { inventory, seatClaims } from "./schema";

/** The moment baseline sales are dated: they happened before anything in the demo. */
const BEFORE_THE_DEMO = new Date(0);

/** Safe to run again: anything already there is left as it is. */
export async function seed(db: Database) {
  const generalTiers = CATALOG.filter((event) => event.seating.kind === "general").flatMap((event) =>
    event.tiers.map((tier) => ({
      tierId: tier.id,
      eventSlug: event.slug,
      capacity: tier.capacity,
      sold: tier.baselineSold,
    })),
  );
  const soldSeats = CATALOG.flatMap((event) =>
    event.seating.kind === "reserved"
      ? [...event.seating.baselineSoldSeatIds].map((seatId) => ({
          eventSlug: event.slug,
          seatId,
          status: "sold" as const,
          claimedAt: BEFORE_THE_DEMO,
        }))
      : [],
  );
  await db.transaction(async (tx) => {
    await tx.insert(inventory).values(generalTiers).onConflictDoNothing();
    if (soldSeats.length) await tx.insert(seatClaims).values(soldSeats).onConflictDoNothing();
  });
}
