/**
 * Reserved seating on the server: choosing the best seats left. Pure functions over a
 * hall and the set of seats already gone; which seats are gone is the inventory's
 * business (`unavailableSeatIds` in inventory.ts).
 */
import type { EventInfo } from "@/core/catalog";
import { findSingleSeatGaps, type Seat, type SeatPlan } from "@/core/seating";

export type ReservedEvent = EventInfo & { seating: Extract<EventInfo["seating"], { kind: "reserved" }> };

export const isReservedEvent = (event: EventInfo): event is ReservedEvent => event.seating.kind === "reserved";

export const freeSeatsInTier = (plan: SeatPlan, unavailable: ReadonlySet<string>, tierId: string) =>
  plan.seats.filter((seat) => seat.tierId === tierId && !unavailable.has(seat.id));

/** How far a run of seats sits from the middle of its section: the smaller, the better the view. */
function distanceFromCentre(seats: readonly Seat[], sectionColumnCount: number) {
  const first = seats[0];
  const last = seats.at(-1);
  if (!first || !last) return Number.POSITIVE_INFINITY;
  return Math.abs((first.column + last.column) / 2 - (sectionColumnCount - 1) / 2);
}

/**
 * Best available, the way a box office picks: the row nearest the stage that has
 * `quantity` free seats side by side in one block (never across an aisle), as central
 * as possible, without stranding a single seat. If no row can seat the party together,
 * the best seats apart — and if there aren't enough at all, nothing.
 */
export function chooseBestSeats(
  plan: SeatPlan,
  unavailable: ReadonlySet<string>,
  tierId: string,
  quantity: number,
): Seat[] | null {
  for (const section of plan.sections) {
    for (const row of section.rows) {
      if (row.tierId !== tierId) continue;
      let best: { seats: Seat[]; distance: number } | null = null;
      for (const block of row.blocks) {
        for (let start = 0; start + quantity <= block.length; start++) {
          const run = block.slice(start, start + quantity);
          if (run.some((seat) => unavailable.has(seat.id))) continue;
          if (findSingleSeatGaps(plan, unavailable, new Set(run.map((seat) => seat.id))).length > 0) continue;
          const distance = distanceFromCentre(run, section.columnCount);
          if (!best || distance < best.distance) best = { seats: run, distance };
        }
      }
      if (best) return best.seats;
    }
  }

  // Nobody can sit together: the best individual seats, front to back, centre out.
  const free = plan.sections.flatMap((section) =>
    section.rows
      .filter((row) => row.tierId === tierId)
      .flatMap((row, rowIndex) =>
        row.seats
          .filter((seat) => !unavailable.has(seat.id))
          .map((seat) => ({ seat, rowIndex, distance: distanceFromCentre([seat], section.columnCount) })),
      ),
  );
  if (free.length < quantity) return null;
  return free
    .sort((left, right) => left.rowIndex - right.rowIndex || left.distance - right.distance)
    .slice(0, quantity)
    .map(({ seat }) => seat);
}
