/**
 * The seat map's keyboard model: the WAI-ARIA APG grid pattern, applied to a hall whose
 * rows have aisles in them and aren't all the same length. Pure — a section, the seat
 * with focus and a key in; the seat to focus next out — so every key is unit-tested
 * without a browser.
 *
 * - Left / Right: the previous or next seat in the row, stepping over aisles; stops at
 *   the row's ends.
 * - Up / Down: the seat in the row in front or behind that's nearest in column — the
 *   seat you'd actually be looking at — so short rows and aisles don't throw you off.
 * - Home / End: the row's first or last seat; with Ctrl, the section's first or last.
 * - Page Up / Page Down: five rows at a time.
 */
import type { Seat, SeatRow, SeatSection } from "@/core/seating";

export const GRID_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;
export type GridKey = (typeof GRID_KEYS)[number];

export const isGridKey = (key: string): key is GridKey => (GRID_KEYS as readonly string[]).includes(key);

/** How far Page Up and Page Down move. */
export const PAGE_ROWS = 5;

/** The seat in `row` nearest to `column`; on a tie, the one to the left. */
function nearestInColumn(row: SeatRow, column: number): Seat | undefined {
  let nearest: Seat | undefined;
  for (const seat of row.seats) {
    if (!nearest || Math.abs(seat.column - column) < Math.abs(nearest.column - column)) nearest = seat;
  }
  return nearest;
}

export function nextSeat(section: SeatSection, current: Seat, key: GridKey, isCtrlPressed = false): Seat {
  const rowIndex = section.rows.findIndex((row) => row.label === current.rowLabel);
  const row = section.rows[rowIndex];
  if (!row) return current;
  const seatIndex = row.seats.findIndex((seat) => seat.id === current.id);
  const toRow = (targetIndex: number) => {
    const target = section.rows[Math.min(section.rows.length - 1, Math.max(0, targetIndex))];
    return (target && nearestInColumn(target, current.column)) ?? current;
  };

  switch (key) {
    case "ArrowLeft":
      return row.seats[seatIndex - 1] ?? current;
    case "ArrowRight":
      return row.seats[seatIndex + 1] ?? current;
    case "ArrowUp":
      return toRow(rowIndex - 1);
    case "ArrowDown":
      return toRow(rowIndex + 1);
    case "PageUp":
      return toRow(rowIndex - PAGE_ROWS);
    case "PageDown":
      return toRow(rowIndex + PAGE_ROWS);
    case "Home":
      return (isCtrlPressed ? section.rows[0]?.seats[0] : row.seats[0]) ?? current;
    case "End":
      return (isCtrlPressed ? section.rows.at(-1)?.seats.at(-1) : row.seats.at(-1)) ?? current;
  }
}
