/**
 * What the server starts from: the catalogue's stock and the seats sold before the
 * demo, the same starting point as the sandbox's (`core/catalog`).
 */
import { sql } from "drizzle-orm";
import { CATALOG } from "@/core/catalog";
import type { Database } from "./db";
import { inventory, seatClaims } from "./schema";

/** The moment baseline sales are dated: they happened before anything in the demo. */
const BEFORE_THE_DEMO = new Date(0);

/**
 * Safe to run again. What the catalogue owns — each tier's event and capacity — is
 * brought up to date, so a hall that grows gets its seats; what the sale has done —
 * tickets sold and held, seats claimed — is left as it is. A capacity cut below what's
 * already sold is refused by the database's own check, loudly, not quietly ignored.
 */
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
    await tx
      .insert(inventory)
      .values(generalTiers)
      .onConflictDoUpdate({
        target: inventory.tierId,
        set: { eventSlug: sql`excluded.event_slug`, capacity: sql`excluded.capacity` },
      });
    if (soldSeats.length) await tx.insert(seatClaims).values(soldSeats).onConflictDoNothing();
  });
}
