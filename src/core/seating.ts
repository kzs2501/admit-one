/**
 * Reserved seating: how a hall is described, and the rules about its seats that the
 * client and the server must agree on.
 *
 * A hall is data — sections of rows, each row a few blocks of seats split by aisles —
 * expanded once into seats with a hall-wide `column`, so seats in rows of different
 * lengths line up the way they do in the room (and moving up a row lands on the seat
 * in front, not the one with the same number).
 */

export interface RowSpec {
  label: string;
  tierId: string;
  /** Seats per block, left to right; an aisle separates one block from the next. */
  blocks: readonly number[];
  /** Seats (by number) that are wheelchair spaces. */
  wheelchairSeatNumbers?: readonly number[];
}

export interface SectionSpec {
  id: string;
  name: string;
  rows: readonly RowSpec[];
}

export interface VenueLayout {
  id: string;
  sections: readonly SectionSpec[];
}

export interface Seat {
  /** `stalls-F-12` */
  id: string;
  sectionId: string;
  sectionName: string;
  rowLabel: string;
  /** Numbered from 1, left to right across the row. */
  number: number;
  /** Position across the section, counting aisles: the same column is the same place in every row. */
  column: number;
  /** Which block of the row the seat is in; aisles separate blocks. */
  blockIndex: number;
  tierId: string;
  isWheelchairSpace: boolean;
}

export interface SeatRow {
  label: string;
  tierId: string;
  /** Seats grouped by block, each block left to right. */
  blocks: readonly (readonly Seat[])[];
  seats: readonly Seat[];
}

export interface SeatSection {
  id: string;
  name: string;
  rows: readonly SeatRow[];
  /** Columns across the section, aisles included. */
  columnCount: number;
}

export interface SeatPlan {
  venueId: string;
  sections: readonly SeatSection[];
  seats: readonly Seat[];
  seatsById: ReadonlyMap<string, Seat>;
}

/** An aisle is one seat wide. */
const AISLE_COLUMNS = 1;

export const seatIdFor = (sectionId: string, rowLabel: string, number: number) => `${sectionId}-${rowLabel}-${number}`;

/** `stalls-F-12`: lowercase section, a row of letters, a seat number. */
export const SEAT_ID_PATTERN = /^[a-z]+-[A-Z]{1,2}-\d{1,3}$/;

interface BlockPlacement {
  /** The block's first column. */
  start: number;
  /** As wide as the block's widest row. */
  width: number;
}

function expandSection(section: SectionSpec): SeatSection {
  const [firstRow] = section.rows;
  const blockCount = firstRow?.blocks.length ?? 0;
  if (section.rows.some((row) => row.blocks.length !== blockCount)) {
    throw new Error(`Every row in ${section.id} needs ${blockCount} blocks, so the aisles line up.`);
  }
  // Each block is as wide as its widest row, and one aisle follows it; a shorter row's
  // block is centred in that space.
  const blockWidths = section.rows.reduce<number[]>(
    (widths, row) => row.blocks.map((size, blockIndex) => Math.max(size, widths[blockIndex] ?? 0)),
    [],
  );
  const placements = blockWidths.reduce<BlockPlacement[]>((placed, width) => {
    const previous = placed.at(-1);
    return [...placed, { start: previous ? previous.start + previous.width + AISLE_COLUMNS : 0, width }];
  }, []);

  const rows = section.rows.map((row): SeatRow => {
    let number = 0;
    const blocks = row.blocks.map((size, blockIndex) => {
      const placement = placements[blockIndex];
      // Unreachable: every row was checked to have the same blocks.
      if (!placement) throw new Error(`No placement for block ${blockIndex} of ${section.id}`);
      const offset = Math.floor((placement.width - size) / 2);
      return Array.from({ length: size }, (_, i): Seat => {
        number += 1;
        return {
          id: seatIdFor(section.id, row.label, number),
          sectionId: section.id,
          sectionName: section.name,
          rowLabel: row.label,
          number,
          column: placement.start + offset + i,
          blockIndex,
          tierId: row.tierId,
          isWheelchairSpace: row.wheelchairSeatNumbers?.includes(number) ?? false,
        };
      });
    });
    return { label: row.label, tierId: row.tierId, blocks, seats: blocks.flat() };
  });

  const lastPlacement = placements.at(-1);
  const columnCount = lastPlacement ? lastPlacement.start + lastPlacement.width : 0;
  return { id: section.id, name: section.name, rows, columnCount };
}

/** A layout, expanded into seats. Do it once, at module scope: the result never changes. */
export function expandLayout(layout: VenueLayout): SeatPlan {
  const sections = layout.sections.map(expandSection);
  const seats = sections.flatMap((section) => section.rows.flatMap((row) => row.seats));
  return { venueId: layout.id, sections, seats, seatsById: new Map(seats.map((seat) => [seat.id, seat])) };
}

/** "Stalls, row F, seat 12" — what a screen reader says and a ticket prints. */
export const seatLabel = (seat: Pick<Seat, "sectionName" | "rowLabel" | "number">) =>
  `${seat.sectionName}, row ${seat.rowLabel}, seat ${seat.number}`;

/** "Stalls F12–F14, G3": seats grouped by section and row, consecutive numbers as ranges. */
export function formatSeatList(seats: readonly Pick<Seat, "sectionName" | "rowLabel" | "number">[]): string {
  const bySection = new Map<string, Map<string, number[]>>();
  for (const seat of seats) {
    const rows = bySection.get(seat.sectionName) ?? new Map<string, number[]>();
    rows.set(seat.rowLabel, [...(rows.get(seat.rowLabel) ?? []), seat.number]);
    bySection.set(seat.sectionName, rows);
  }
  return [...bySection]
    .map(([sectionName, rows]) => {
      const ranges = [...rows].flatMap(([rowLabel, numbers]) =>
        toRanges(numbers).map(([first, last]) =>
          first === last ? `${rowLabel}${first}` : `${rowLabel}${first}–${rowLabel}${last}`,
        ),
      );
      return `${sectionName} ${ranges.join(", ")}`;
    })
    .join(" · ");
}

function toRanges(numbers: readonly number[]): [number, number][] {
  const sorted = [...numbers].sort((left, right) => left - right);
  const ranges: [number, number][] = [];
  for (const number of sorted) {
    const last = ranges.at(-1);
    if (last && number === last[1] + 1) last[1] = number;
    else ranges.push([number, number]);
  }
  return ranges;
}

/**
 * The single-seat-gap rule: a selection may not strand one free seat between itself
 * and a taken seat, another selected seat, an aisle or the end of a row — a seat
 * nobody can buy as part of a pair. Only gaps next to the selection count; a gap that
 * was already there isn't the buyer's doing. Returns the seats that would be stranded.
 */
export function findSingleSeatGaps(
  plan: SeatPlan,
  unavailableSeatIds: ReadonlySet<string>,
  selectedSeatIds: ReadonlySet<string>,
): Seat[] {
  const isTaken = (seat: Seat | undefined) =>
    seat === undefined || unavailableSeatIds.has(seat.id) || selectedSeatIds.has(seat.id);
  const touchedBlocks = new Set(
    [...selectedSeatIds].flatMap((seatId) => {
      const seat = plan.seatsById.get(seatId);
      return seat ? [`${seat.sectionId}-${seat.rowLabel}-${seat.blockIndex}`] : [];
    }),
  );

  const gaps: Seat[] = [];
  for (const section of plan.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        const [first] = block;
        if (!first || !touchedBlocks.has(`${first.sectionId}-${first.rowLabel}-${first.blockIndex}`)) continue;
        block.forEach((seat, i) => {
          if (isTaken(seat)) return;
          const left = block[i - 1];
          const right = block[i + 1];
          const isNextToSelection =
            (left !== undefined && selectedSeatIds.has(left.id)) ||
            (right !== undefined && selectedSeatIds.has(right.id));
          if (isNextToSelection && isTaken(left) && isTaken(right)) gaps.push(seat);
        });
      }
    }
  }
  return gaps;
}
