// @vitest-environment node
import { describe, expect, it } from "vitest";
import { expandLayout, type VenueLayout } from "@/core/seating";
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
});
