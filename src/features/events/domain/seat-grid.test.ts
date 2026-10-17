import { describe, expect, it } from "vitest";
import { expandLayout } from "@/core/seating";
import { nextSeat, type GridKey } from "./seat-grid";

// Row A is short (2 | 4 | 2) and sits centred over the full rows (3 | 5 | 3).
// Columns:  A: 0 1 · 4 5 6 7 · 10 11      B–G: 0 1 2 · 4 5 6 7 8 · 10 11 12
const plan = expandLayout({
  id: "test-hall",
  sections: [
    {
      id: "stalls",
      name: "Stalls",
      rows: ["A", "B", "C", "D", "E", "F", "G"].map((label, index) => ({
        label,
        tierId: "t",
        blocks: index === 0 ? [2, 4, 2] : [3, 5, 3],
      })),
    },
  ],
});
const [section] = plan.sections;
if (!section) throw new Error("The test hall needs a section");
const move = (fromSeatId: string, key: GridKey, isCtrlPressed = false) => {
  const from = plan.seatsById.get(fromSeatId);
  if (!from) throw new Error(`No seat ${fromSeatId}`);
  return nextSeat(section, from, key, isCtrlPressed).id;
};

describe("nextSeat", () => {
  it("steps along a row, over aisles, and stops at its ends", () => {
    expect(move("stalls-A-2", "ArrowRight")).toBe("stalls-A-3"); // across the aisle
    expect(move("stalls-A-3", "ArrowLeft")).toBe("stalls-A-2");
    expect(move("stalls-A-1", "ArrowLeft")).toBe("stalls-A-1");
    expect(move("stalls-A-8", "ArrowRight")).toBe("stalls-A-8");
  });

  it("moves between rows to the seat nearest in column, not the one with the same number", () => {
    // B8 is at column 8. The seat in front is A6 (column 7), not A8 (column 11).
    expect(move("stalls-B-8", "ArrowUp")).toBe("stalls-A-6");
    // B3 (column 2) is closer to A2 (column 1) than to A3 across the aisle (column 4).
    expect(move("stalls-B-3", "ArrowUp")).toBe("stalls-A-2");
    expect(move("stalls-A-3", "ArrowDown")).toBe("stalls-B-4");
  });

  it("stays put at the front and back of the section", () => {
    expect(move("stalls-A-4", "ArrowUp")).toBe("stalls-A-4");
    expect(move("stalls-G-5", "ArrowDown")).toBe("stalls-G-5");
  });

  it("goes to the row's ends with Home and End, and the section's with Ctrl", () => {
    expect(move("stalls-C-6", "Home")).toBe("stalls-C-1");
    expect(move("stalls-C-6", "End")).toBe("stalls-C-11");
    expect(move("stalls-C-6", "Home", true)).toBe("stalls-A-1");
    expect(move("stalls-C-6", "End", true)).toBe("stalls-G-11");
  });

  it("pages five rows at a time, stopping at the first and last rows", () => {
    expect(move("stalls-A-1", "PageDown")).toBe("stalls-F-1");
    expect(move("stalls-D-1", "PageDown")).toBe("stalls-G-1");
    expect(move("stalls-G-1", "PageUp")).toBe("stalls-B-1");
    expect(move("stalls-C-1", "PageUp")).toBe("stalls-A-1");
  });
});
