/**
 * Halls with reserved seating, as data. Fictional, like everything in the catalogue.
 */
import { expandLayout, type RowSpec, type SeatPlan, type VenueLayout } from "./seating";

/** Theatres skip I and O, which read as 1 and 0 on a ticket. */
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const rows = (count: number, rowSpec: (index: number) => Omit<RowSpec, "label">): RowSpec[] =>
  Array.from(ROW_LETTERS.slice(0, count), (label, index) => ({ label, ...rowSpec(index) }));

export const RANGMANCH_LAYOUT: VenueLayout = {
  id: "rangmanch-auditorium",
  sections: [
    {
      id: "stalls",
      name: "Stalls",
      // Twenty rows. The first three curve in, so they're shorter; the last has level
      // access, with a wheelchair space at each end.
      rows: rows(20, (index) => ({
        tierId: index < 6 ? "ms-premium" : "ms-stalls",
        blocks: index < 3 ? [7, 14, 7] : [9, 16, 9],
        ...(index === 19 ? { wheelchairSeatNumbers: [1, 34] } : {}),
      })),
    },
    {
      id: "balcony",
      name: "Balcony",
      rows: rows(12, () => ({ tierId: "ms-balcony", blocks: [6, 16, 6] })),
    },
  ],
};

export const RANGMANCH_PLAN: SeatPlan = expandLayout(RANGMANCH_LAYOUT);

/** mulberry32: a tiny seeded generator, so "already sold" is the same on every run. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Seats sold before the sandbox started: runs of two to four, the way groups book,
 * busiest near the stage. Deterministic for a given seed, so tests and screenshots
 * see the same hall every time.
 */
export function baselineSoldSeatIds(plan: SeatPlan, seed: number): ReadonlySet<string> {
  const random = seededRandom(seed);
  const sold = new Set<string>();
  for (const section of plan.sections) {
    section.rows.forEach((row, rowIndex) => {
      const runStartChance = section.id === "stalls" ? 0.22 - rowIndex * 0.008 : 0.1;
      for (const block of row.blocks) {
        let i = 0;
        while (i < block.length) {
          if (random() < runStartChance) {
            const runLength = 2 + Math.floor(random() * 3);
            for (const seat of block.slice(i, i + runLength)) sold.add(seat.id);
            i += runLength + 1;
          } else {
            i += 1;
          }
        }
      }
    });
  }
  return sold;
}
