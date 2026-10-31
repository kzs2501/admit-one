"use client";

import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { Seat, SeatSection } from "@/core/seating";
import { isGridKey, nextSeat } from "@/features/events/domain/seat-grid";
import type { TierTone } from "@/features/events/domain/tier-tones";
import { SeatCell, type SeatCellState } from "./seat-cell";

/** Tier id → what a seat's name says about it. */
export type TierLabels = ReadonlyMap<string, { name: string; price: string }>;

const seatIdOf = (target: EventTarget) =>
  target instanceof Element ? (target.closest("[data-seat-id]")?.getAttribute("data-seat-id") ?? null) : null;

/**
 * One section of the hall as a WAI-ARIA grid: rows with a row header, seats as
 * gridcells, one tab stop (roving tabindex) and the APG keys (`nextSeat`). Clicks,
 * keys and focus are handled here once for every seat (event delegation), so each
 * seat can be a plain memoised cell.
 */
export function SeatGrid({
  section,
  stateOf,
  tiers,
  tones,
  onToggle,
  isLoading,
}: {
  section: SeatSection;
  stateOf: (seat: Seat) => SeatCellState;
  tiers: TierLabels;
  /** Each tier's colour (`tierTones`). */
  tones: ReadonlyMap<string, TierTone>;
  onToggle: (seatId: string) => void;
  isLoading: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [focusedSeatId, setFocusedSeatId] = useState<string | null>(null);
  const seats = section.rows.flatMap((row) => row.seats);
  const findSeat = (seatId: string) => seats.find((seat) => seat.id === seatId);

  // Tab lands on the seat last focused, else the first chosen seat, else the first free one.
  const tabStopId =
    (focusedSeatId && findSeat(focusedSeatId)?.id) ??
    seats.find((seat) => stateOf(seat) === "selected")?.id ??
    seats.find((seat) => stateOf(seat) === "free")?.id ??
    seats[0]?.id;

  const focusSeat = (seatId: string) => {
    setFocusedSeatId(seatId);
    const cell = grid.current?.querySelector(`[data-seat-id="${seatId}"]`);
    if (cell instanceof HTMLElement) {
      cell.focus();
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const seat = findSeat(seatIdOf(event.target) ?? "");
    if (!seat) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle(seat.id);
      return;
    }
    if (!isGridKey(event.key)) return;
    event.preventDefault();
    focusSeat(nextSeat(section, seat, event.key, event.ctrlKey || event.metaKey).id);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const seatId = seatIdOf(event.target);
    if (seatId) onToggle(seatId);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const seatId = seatIdOf(event.target);
    if (seatId) setFocusedSeatId(seatId);
  };

  const labelOf = (seat: Seat, state: SeatCellState) => {
    const tier = tiers.get(seat.tierId);
    return [
      `Row ${seat.rowLabel}, seat ${seat.number}`,
      tier && `${tier.name}, ${tier.price}`,
      seat.isWheelchairSpace && "wheelchair space",
      state === "taken" && "taken",
    ]
      .filter(Boolean)
      .join(", ");
  };

  const headingId = `seat-section-${section.id}`;
  return (
    <div className="w-max">
      <h3 id={headingId} className="mb-2 text-sm font-medium text-ink-2">
        {section.name}
      </h3>
      <div
        ref={grid}
        role="grid"
        aria-labelledby={headingId}
        aria-multiselectable="true"
        aria-busy={isLoading || undefined}
        aria-rowcount={section.rows.length}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onFocus={onFocus}
        className="space-y-1"
      >
        {section.rows.map((row, rowIndex) => (
          <div
            key={row.label}
            role="row"
            aria-rowindex={rowIndex + 1}
            // A little space where one price tier ends and the next begins.
            // A row out of view isn't styled, laid out or painted until it nears the view
            // (it stays in the accessibility tree), at the size it would have. That also
            // clips what the row paints to its box, and a focused seat's ring (2 px, 2 px
            // out) goes past it: so only where the clip can be widened to fit the ring.
            className={`grid gap-x-0.5 supports-[overflow-clip-margin:4px]:[content-visibility:auto] ${rowIndex > 0 && section.rows[rowIndex - 1]?.tierId !== row.tierId ? "pt-4" : ""}`}
            style={{
              gridTemplateColumns: `1.75rem repeat(${section.columnCount}, var(--seat-size))`,
              containIntrinsicSize: `auto calc(1.75rem + ${section.columnCount} * (var(--seat-size) + 0.125rem)) auto var(--seat-size)`,
              overflowClipMargin: "4px",
            }}
          >
            <div role="rowheader" className="tabular grid place-items-center text-xs text-ink-3">
              {row.label}
            </div>
            {row.seats.map((seat) => {
              const state = stateOf(seat);
              return (
                <SeatCell
                  key={seat.id}
                  seat={seat}
                  state={state}
                  isTabStop={seat.id === tabStopId}
                  tone={tones.get(seat.tierId) ?? 3}
                  label={labelOf(seat, state)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
