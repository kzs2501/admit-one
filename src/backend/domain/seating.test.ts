// @vitest-environment node
import { describe, expect, it } from "vitest";
import { expandLayout, findSingleSeatGaps, type VenueLayout } from "@/core/seating";
import { chooseBestSeats } from "./seating";

/** Row A is the front row; blocks of 3 | 5 | 3 seats between two aisles. */
const HALL: VenueLayout = {
  id: "test-hall",
  sections: [
    {
      id: "stalls",
      name: "Stalls",
      rows: [
        { label: "A", tierId: "front", blocks: [3, 5, 3] },
        { label: "B", tierId: "front", blocks: [3, 5, 3] },
      ],
    },
  ],
};
const plan = expandLayout(HALL);
const choose = (unavailable: string[], quantity: number) =>
  chooseBestSeats(plan, new Set(unavailable), "front", quantity)?.map((seat) => seat.id) ?? null;
const wholeRow = (rowLabel: string) => plan.seats.filter((seat) => seat.rowLabel === rowLabel).map((seat) => seat.id);

describe("chooseBestSeats", () => {
  it("seats a party together in the front row, as central as it can without stranding a seat", () => {
    // The centre block is A4–A8. Its middle three (A5–A7) would leave A4 and A8 alone at
    // the aisles, so it takes the next most central three.
    expect(choose([], 3)).toEqual(["stalls-A-4", "stalls-A-5", "stalls-A-6"]);
  });

  it("moves back a row rather than split the party", () => {
    // Row A has no three free seats together in any block.
    const taken = ["stalls-A-4", "stalls-A-5", "stalls-A-6", "stalls-A-1", "stalls-A-11"];
    expect(choose(taken, 3)).toEqual(["stalls-B-4", "stalls-B-5", "stalls-B-6"]);
  });

  it("never counts seats across an aisle as together", () => {
    // Row A's only free seats, A3 and A4, look adjacent but are an aisle apart; row B has
    // a real pair, so the party goes there.
    const free = new Set(["stalls-A-3", "stalls-A-4", "stalls-B-9", "stalls-B-10"]);
    const taken = [...wholeRow("A"), ...wholeRow("B")].filter((id) => !free.has(id));
    expect(choose(taken, 2)).toEqual(["stalls-B-9", "stalls-B-10"]);
  });

  it("won't strand a single seat when it can avoid it", () => {
    // A5–A6 would leave A4 alone by the aisle and A7 alone by A8; A6–A7 leaves A4–A5 together.
    expect(choose(["stalls-A-8"], 2)).toEqual(["stalls-A-6", "stalls-A-7"]);
  });

  it("falls back to the best seats apart when nobody can sit together, and to nothing when there aren't enough", () => {
    const leftFree = new Set(["stalls-A-1", "stalls-A-6", "stalls-B-9"]);
    const taken = plan.seats.map((seat) => seat.id).filter((id) => !leftFree.has(id));
    expect(choose(taken, 2)).toEqual(["stalls-A-6", "stalls-A-1"]);
    expect(choose(taken, 4)).toBeNull();
  });

  it("apart, still won't strand a seat when it can avoid it", () => {
    // Row A's centre block has A4–A6 free; row B has B1 and B11 at its ends. Nobody can
    // sit two together without leaving one of A4–A6 alone, so the pair is split, and
    // taking A5 (the most central) would strand A4 and A6: A4 goes with B1 instead.
    const free = new Set(["stalls-A-4", "stalls-A-5", "stalls-A-6", "stalls-B-1", "stalls-B-11"]);
    const taken = plan.seats.map((seat) => seat.id).filter((id) => !free.has(id));
    const chosen = choose(taken, 2) ?? [];
    expect(chosen).toHaveLength(2);
    expect(findSingleSeatGaps(plan, new Set(taken), new Set(chosen))).toEqual([]);
    expect(chosen.filter((id) => id.startsWith("stalls-A-"))).toHaveLength(1);
  });

  it("takes the last seats in a tier even if one is left alone, rather than refuse them", () => {
    // A5–A6 and B6 are all that's left, and three are wanted: every way of choosing them
    // takes the pair apart, but that's the whole tier.
    const free = new Set(["stalls-A-5", "stalls-A-6", "stalls-B-6"]);
    const taken = plan.seats.map((seat) => seat.id).filter((id) => !free.has(id));
    expect(new Set(choose(taken, 3))).toEqual(free);
  });

  it("apart, fills rows from the stage back across sections, not row by row within each", () => {
    const twoSections = expandLayout({
      id: "two-sections",
      sections: [
        {
          id: "stalls",
          name: "Stalls",
          rows: [
            { label: "A", tierId: "front", blocks: [5] },
            { label: "B", tierId: "front", blocks: [5] },
          ],
        },
        { id: "balcony", name: "Balcony", rows: [{ label: "A", tierId: "front", blocks: [5] }] },
      ],
    });
    // Only single seats are left: the stalls' edge seats, and the balcony's centre one.
    const free = new Set(["stalls-A-1", "stalls-B-1", "balcony-A-3"]);
    const taken = new Set(twoSections.seats.map((seat) => seat.id).filter((id) => !free.has(id)));
    const chosen = chooseBestSeats(twoSections, taken, "front", 2)?.map((seat) => seat.id);
    expect(chosen).toEqual(["stalls-A-1", "stalls-B-1"]);
  });
});
