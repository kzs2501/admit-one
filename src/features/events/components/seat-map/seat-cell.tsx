import { memo, type ReactNode } from "react";
import type { Seat } from "@/core/seating";

export type SeatCellState = "free" | "selected" | "taken" | "loading";

const STATE_CLASSES: Record<SeatCellState, string> = {
  free: "cursor-pointer border-ink-3 text-ink-3 hover:border-accent hover:text-accent forced-colors:border-[ButtonText]",
  selected:
    "cursor-pointer border-accent bg-accent text-accent-ink forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]",
  taken:
    "cursor-not-allowed border-transparent bg-sunk text-ink-3 forced-colors:border-[GrayText] forced-colors:text-[GrayText]",
  loading: "border-line bg-card text-transparent",
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-[60%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** What a seat shows besides colour: a tick when chosen, a cross when gone, a wheelchair for a wheelchair space. */
export function SeatGlyph({ state, isWheelchairSpace }: { state: SeatCellState; isWheelchairSpace: boolean }) {
  switch (state) {
    case "selected":
      return (
        <Glyph>
          <path d="M4 8.5 7 11.5 12 5" />
        </Glyph>
      );
    case "taken":
      return (
        <Glyph>
          <path d="M5 5l6 6M11 5l-6 6" />
        </Glyph>
      );
    case "free":
      return isWheelchairSpace ? (
        <Glyph>
          <circle cx="7" cy="2.5" r="1.3" fill="currentColor" stroke="none" />
          <path d="M7 5v4.5h3.5l1.5 3" />
          <path d="M5.2 7.6a3.5 3.5 0 1 0 4.6 4.6" />
        </Glyph>
      ) : null;
    case "loading":
      return null;
  }
}

/**
 * One seat: a `gridcell` that's focusable (only one per grid is in the tab order — the
 * grid moves focus with the arrow keys), selected via `aria-selected`, and unavailable
 * via `aria-disabled` — still focusable, so a screen-reader user can hear the whole
 * hall, not just what's left. Memoised with primitive props: picking one seat
 * re-renders that seat, not the other thousand. Clicks and keys are handled by the
 * grid, once, for every seat.
 */
export const SeatCell = memo(function SeatCell({
  seat,
  state,
  isTabStop,
  isFeaturedTier,
  label,
}: {
  seat: Seat;
  state: SeatCellState;
  isTabStop: boolean;
  /** The event's top price tier, tinted so its rows stand out (the legend says which rows, in words). */
  isFeaturedTier: boolean;
  label: string;
}) {
  return (
    <div
      role="gridcell"
      data-seat-id={seat.id}
      tabIndex={isTabStop ? 0 : -1}
      aria-selected={state === "selected"}
      aria-disabled={state === "taken" || state === "loading" || undefined}
      aria-label={label}
      style={{ gridColumnStart: seat.column + 2 }}
      // scroll-mb: a seat scrolled into view by the keyboard stops above the sticky
      // "Your seats" bar, so focus is never hidden behind it (WCAG 2.2, SC 2.4.11).
      className={`grid size-(--seat-size) scroll-mb-64 place-items-center rounded-t-lg rounded-b-sm border-2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${STATE_CLASSES[state]} ${state === "free" ? (isFeaturedTier ? "bg-accent-soft" : "bg-card") : ""}`}
    >
      <SeatGlyph state={state} isWheelchairSpace={seat.isWheelchairSpace} />
    </div>
  );
});
