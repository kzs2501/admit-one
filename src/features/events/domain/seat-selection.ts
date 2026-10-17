/**
 * The seats a buyer has picked on the map. The selection is just ids, in the order
 * they were picked; everything else — which of them someone else has since taken,
 * whether they'd strand a seat — is derived from it and the latest availability, in
 * render. Nothing has to be kept in sync.
 */
import { findSingleSeatGaps, type Seat, type SeatPlan } from "@/core/seating";
import { MAX_TICKETS_PER_ORDER } from "@/core/ticketing";

export type SelectionAction =
  { type: "toggle"; seatId: string } | { type: "remove"; seatIds: readonly string[] } | { type: "clear" };

export function selectionReducer(selected: readonly string[], action: SelectionAction): readonly string[] {
  switch (action.type) {
    case "toggle":
      if (selected.includes(action.seatId)) return selected.filter((seatId) => seatId !== action.seatId);
      return selected.length < MAX_TICKETS_PER_ORDER ? [...selected, action.seatId] : selected;
    case "remove":
      return selected.filter((seatId) => !action.seatIds.includes(seatId));
    case "clear":
      return [];
  }
}

export interface DerivedSelection {
  /** Picked and still free. */
  seats: Seat[];
  /** Picked, but someone else has taken them since. */
  lostSeats: Seat[];
  /** Free seats the selection would leave stranded on their own. */
  gapSeats: Seat[];
  isAtLimit: boolean;
}

export function deriveSelection(
  plan: SeatPlan,
  selectedSeatIds: readonly string[],
  unavailableSeatIds: ReadonlySet<string>,
): DerivedSelection {
  const picked = selectedSeatIds.flatMap((seatId) => {
    const seat = plan.seatsById.get(seatId);
    return seat ? [seat] : [];
  });
  const seats = picked.filter((seat) => !unavailableSeatIds.has(seat.id));
  return {
    seats,
    lostSeats: picked.filter((seat) => unavailableSeatIds.has(seat.id)),
    gapSeats: findSingleSeatGaps(plan, unavailableSeatIds, new Set(seats.map((seat) => seat.id))),
    isAtLimit: seats.length >= MAX_TICKETS_PER_ORDER,
  };
}
