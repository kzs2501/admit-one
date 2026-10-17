// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  expandLayout,
  findSingleSeatGaps,
  formatSeatList,
  SEAT_ID_PATTERN,
  seatLabel,
  type VenueLayout,
} from "./seating";

/** Two rows: a shorter front row (2 | 4 | 2) and a full one (3 | 5 | 3). */
const HALL: VenueLayout = {
  id: "test-hall",
  sections: [
    {
      id: "stalls",
      name: "Stalls",
      rows: [
        { label: "A", tierId: "front", blocks: [2, 4, 2] },
        { label: "B", tierId: "back", blocks: [3, 5, 3], wheelchairSeatNumbers: [1] },
      ],
    },
  ],
};
const plan = expandLayout(HALL);
const ids = (...seatIds: string[]) => new Set(seatIds);

describe("expandLayout", () => {
  it("numbers every seat once, left to right, with ids it can parse", () => {
    expect(plan.seats).toHaveLength(8 + 11);
    expect(new Set(plan.seats.map((seat) => seat.id)).size).toBe(plan.seats.length);
    expect(plan.seats.every((seat) => SEAT_ID_PATTERN.test(seat.id))).toBe(true);
    expect(plan.sections[0]?.rows[1]?.seats.map((seat) => seat.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(plan.seatsById.get("stalls-B-1")?.isWheelchairSpace).toBe(true);
    expect(plan.seatsById.get("stalls-B-2")?.isWheelchairSpace).toBe(false);
  });

  it("lines the aisles up, and centres a shorter row's blocks in their space", () => {
    const columnsOf = (rowLabel: string) =>
      plan.seats.filter((seat) => seat.rowLabel === rowLabel).map((seat) => seat.column);
    // Row B: 0–2 | aisle 3 | 4–8 | aisle 9 | 10–12.
    expect(columnsOf("B")).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 12]);
    // Row A's blocks (2, 4, 2) sit centred in B's (3, 5, 3): the aisles are at the same columns.
    expect(columnsOf("A")).toEqual([0, 1, 4, 5, 6, 7, 10, 11]);
    expect(plan.sections[0]?.columnCount).toBe(13);
  });

  it("expands an empty section to nothing", () => {
    const empty = expandLayout({ id: "empty", sections: [{ id: "stalls", name: "Stalls", rows: [] }] });
    expect(empty.seats).toEqual([]);
    expect(empty.sections[0]?.columnCount).toBe(0);
  });

  it("refuses rows whose aisles can't line up", () => {
    const crooked: VenueLayout = {
      id: "crooked",
      sections: [
        {
          id: "stalls",
          name: "Stalls",
          rows: [
            { label: "A", tierId: "t", blocks: [2, 2] },
            { label: "B", tierId: "t", blocks: [4] },
          ],
        },
      ],
    };
    expect(() => expandLayout(crooked)).toThrow(/aisles line up/);
  });
});

describe("seat labels", () => {
  it("names a seat the way a ticket prints it", () => {
    expect(seatLabel({ sectionName: "Stalls", rowLabel: "F", number: 12 })).toBe("Stalls, row F, seat 12");
  });

  it("groups seats by section and row, with consecutive numbers as ranges", () => {
    const seat = (sectionName: string, rowLabel: string, number: number) => ({ sectionName, rowLabel, number });
    expect(
      formatSeatList([
        seat("Stalls", "F", 14),
        seat("Stalls", "F", 12),
        seat("Stalls", "F", 13),
        seat("Stalls", "G", 3),
      ]),
    ).toBe("Stalls F12–F14, G3");
    expect(formatSeatList([seat("Stalls", "A", 1), seat("Balcony", "C", 7)])).toBe("Stalls A1 · Balcony C7");
  });
});

describe("findSingleSeatGaps", () => {
  const gapsFor = (unavailable: Set<string>, selected: Set<string>) =>
    findSingleSeatGaps(plan, unavailable, selected).map((seat) => seat.id);

  it.each([
    {
      name: "a seat left between the selection and a taken seat",
      unavailable: ids("stalls-B-4"),
      selected: ids("stalls-B-6"),
      gaps: ["stalls-B-5"],
    },
    {
      name: "a seat left between the selection and an aisle",
      unavailable: ids(),
      selected: ids("stalls-B-5", "stalls-B-6"),
      gaps: ["stalls-B-4"],
    },
    {
      name: "a seat left at the end of a row",
      unavailable: ids(),
      selected: ids("stalls-B-2", "stalls-B-3"),
      gaps: ["stalls-B-1"],
    },
    {
      name: "a seat left between two selected seats",
      unavailable: ids(),
      selected: ids("stalls-B-4", "stalls-B-6"),
      gaps: ["stalls-B-5"],
    },
    {
      name: "nothing, when the selection fills up to the aisle",
      unavailable: ids(),
      selected: ids("stalls-B-4", "stalls-B-5"),
      gaps: [],
    },
    {
      name: "nothing, when two seats are left free",
      unavailable: ids("stalls-B-4"),
      selected: ids("stalls-B-7", "stalls-B-8"),
      gaps: [],
    },
    {
      name: "only the gap the selection made, not one that was already there",
      unavailable: ids("stalls-B-4", "stalls-B-6"),
      selected: ids("stalls-B-8"),
      gaps: ["stalls-B-7"],
    },
  ])("finds $name", ({ unavailable, selected, gaps }) => {
    expect(gapsFor(unavailable, selected)).toEqual(gaps);
  });

  it("ignores seat ids that aren't in the hall", () => {
    expect(gapsFor(ids(), ids("stalls-Z-99"))).toEqual([]);
  });

  it("stops at aisles: the seat across one belongs to another block", () => {
    // B3 is the last seat of the left block; B4 starts the centre block.
    expect(gapsFor(ids("stalls-B-2"), ids("stalls-B-4", "stalls-B-5", "stalls-B-6", "stalls-B-7"))).toEqual([
      "stalls-B-8",
    ]);
  });
});
