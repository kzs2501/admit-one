import { formatSeatList, seatLabel, type Seat } from "@/core/seating";
import { MAX_TICKETS_PER_ORDER } from "@/core/ticketing";
import { Button } from "@/components/ui/button";

/**
 * The seats chosen so far, in a compact bar that sticks to the bottom of the screen
 * while the map scrolls, so the choice and Reserve are always in reach. Each seat can
 * be removed from here too — a path that doesn't need the map. Seats on the map keep a
 * scroll margin, so keyboard focus is never hidden behind this bar.
 */
export function SelectedSeats({
  seats,
  gapSeats,
  totalLabel,
  onRemove,
  onReserve,
  canReserve,
  isReserving,
}: {
  seats: readonly Seat[];
  gapSeats: readonly Seat[];
  totalLabel: string;
  onRemove: (seatId: string) => void;
  onReserve: () => void;
  canReserve: boolean;
  isReserving: boolean;
}) {
  const gapId = "seat-gap-warning";
  return (
    <div
      // A landmark's name should stay put; the heading inside says which seats.
      role="region"
      aria-label="Your seats"
      className="sticky bottom-3 z-10 mt-4 rounded-xl border border-line bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            Your seats
            {seats.length > 0 && <span className="font-normal text-ink-2"> · {formatSeatList(seats)}</span>}
          </h3>
          {seats.length === 0 && <p className="text-sm text-ink-3">Choose up to {MAX_TICKETS_PER_ORDER} on the map.</p>}
        </div>
        <div className="flex items-center gap-3">
          {seats.length > 0 && (
            <p className="tabular text-sm whitespace-nowrap">
              <span className="font-medium">{totalLabel}</span> <span className="text-ink-3">all in</span>
            </p>
          )}
          <Button
            onClick={onReserve}
            disabled={!canReserve}
            isBusy={isReserving}
            aria-describedby={gapSeats.length > 0 ? gapId : undefined}
            className="whitespace-nowrap"
          >
            {isReserving ? "Reserving…" : seats.length > 1 ? `Reserve ${seats.length} seats` : "Reserve seat"}
          </Button>
        </div>
      </div>
      {seats.length > 0 && (
        <ul aria-label="Chosen seats" className="mt-2 flex gap-2 overflow-x-auto">
          {seats.map((seat) => (
            <li
              key={seat.id}
              className="flex shrink-0 items-center gap-1 rounded-full border border-line py-0.5 pr-0.5 pl-3 text-xs"
            >
              {seat.sectionName} {seat.rowLabel}
              {seat.number}
              <button
                type="button"
                onClick={() => onRemove(seat.id)}
                aria-label={`Remove ${seatLabel(seat)}`}
                className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {gapSeats.length > 0 && (
        <p id={gapId} className="mt-2 text-sm text-warn">
          That would leave {formatSeatList(gapSeats)} on {gapSeats.length === 1 ? "its" : "their"} own. Choose it too,
          or move over by one seat.
        </p>
      )}
    </div>
  );
}
