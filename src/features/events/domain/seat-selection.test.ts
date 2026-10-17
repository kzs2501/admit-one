import { describe, expect, it } from "vitest";
import { expandLayout } from "@/core/seating";
import { MAX_TICKETS_PER_ORDER } from "@/core/ticketing";
import { deriveSelection, selectionReducer } from "./seat-selection";

const plan = expandLayout({
  id: "test-hall",
  sections: [{ id: "stalls", name: "Stalls", rows: [{ label: "A", tierId: "t", blocks: [10] }] }],
});
const seat = (number: number) => `stalls-A-${number}`;

describe("selectionReducer", () => {
  it("picks and unpicks a seat", () => {
    const picked = selectionReducer([], { type: "toggle", seatId: seat(1) });
    expect(picked).toEqual([seat(1)]);
    expect(selectionReducer(picked, { type: "toggle", seatId: seat(1) })).toEqual([]);
  });

  it("stops at the order limit, leaving the selection as it was", () => {
    const full = Array.from({ length: MAX_TICKETS_PER_ORDER }, (_, i) => seat(i + 1));
    expect(selectionReducer(full, { type: "toggle", seatId: seat(9) })).toBe(full);
  });

  it("drops seats the server said are taken, and clears", () => {
    const picked = [seat(1), seat(2), seat(3)];
    expect(selectionReducer(picked, { type: "remove", seatIds: [seat(2), seat(3)] })).toEqual([seat(1)]);
    expect(selectionReducer(picked, { type: "clear" })).toEqual([]);
  });
});

describe("deriveSelection", () => {
  const ids = (seats: { id: string }[]) => seats.map((each) => each.id);

  it("separates the seats still free from the ones someone else has since taken", () => {
    const derived = deriveSelection(plan, [seat(4), seat(5), seat(6)], new Set([seat(6)]));
    expect(ids(derived.seats)).toEqual([seat(4), seat(5)]);
    expect(ids(derived.lostSeats)).toEqual([seat(6)]);
  });

  it("points out a seat the selection would strand", () => {
    expect(ids(deriveSelection(plan, [seat(2), seat(3)], new Set()).gapSeats)).toEqual([seat(1)]);
    expect(deriveSelection(plan, [seat(1), seat(2)], new Set()).gapSeats).toEqual([]);
  });

  it("knows when the order is full, and ignores ids that aren't seats", () => {
    const six = Array.from({ length: 6 }, (_, i) => seat(i + 1));
    expect(deriveSelection(plan, six, new Set()).isAtLimit).toBe(true);
    expect(ids(deriveSelection(plan, ["nowhere-Z-1"], new Set()).seats)).toEqual([]);
  });
});
