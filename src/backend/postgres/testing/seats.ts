/** Finding seats to hold in tests. Only tests import this. */
import { getSeatPlan } from "@/core/catalog";
import { seatSelectionProblem } from "@/backend/domain/inventory";
import type { Database } from "@/backend/postgres/db";
import { unavailableSeatIds } from "@/backend/postgres/stock";

/** Two free seats side by side that can be held without stranding a single seat. */
export async function freeSeatPair(db: Database, eventSlug: string, now: Date): Promise<string[]> {
  const plan = getSeatPlan(eventSlug);
  const unavailable = await unavailableSeatIds(db, eventSlug, now);
  for (const row of plan.sections.flatMap((section) => section.rows)) {
    for (const block of row.blocks) {
      for (let start = 0; start + 2 <= block.length; start++) {
        const pair = block.slice(start, start + 2);
        if (!seatSelectionProblem(plan, unavailable, pair)) return pair.map((seat) => seat.id);
      }
    }
  }
  throw new Error(`No free pair of seats left at ${eventSlug}`);
}
