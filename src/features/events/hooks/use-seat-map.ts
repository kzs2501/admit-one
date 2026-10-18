import { useCallback, useMemo, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SeatPlan } from "@/core/seating";
import { problemOf } from "@/lib/api-client";
import { seatQueries, shouldShowQueryError } from "@/lib/queries";
import { deriveSelection, selectionReducer, type DerivedSelection } from "@/features/events/domain/seat-selection";
import { useReserveHold } from "./use-reserve-hold";

/** Seats change hands while the map is open; refresh it this often (paused while the tab is hidden). */
const AVAILABILITY_REFRESH_MS = 5_000;

const NO_SEATS: ReadonlySet<string> = new Set();

/** What the map knows about which seats are gone — exactly one at a time. */
export type SeatAvailability =
  | { kind: "loading" }
  | { kind: "load-error"; retry: () => void }
  | { kind: "ready"; unavailableSeatIds: ReadonlySet<string> };

/** Something the buyer has to know about their choice, from the server. */
export interface SeatConflict {
  title: string;
  detail: string;
}

export interface SeatMapModel {
  availability: SeatAvailability;
  selection: DerivedSelection;
  /** Pick or unpick a seat. Seats that are gone, or not known yet, can't be picked. */
  toggle: (seatId: string) => void;
  remove: (seatId: string) => void;
  /** Forget the seats someone else took since they were picked. */
  dismissLostSeats: () => void;
  reserve: () => void;
  canReserve: boolean;
  isReserving: boolean;
  conflict: SeatConflict | null;
  /** When reserving may be tried again, after a 429; null when it may now. */
  retryAtMs: number | null;
  onRetryReady: () => void;
}

/**
 * The seat map's view-model. The hall comes from static data; which seats are gone is
 * polled. The selection is a list of ids, and everything about it — seats taken since,
 * a seat it would strand — is derived in render against the latest availability, so
 * the map never shows a stale "selected" seat as reservable.
 */
export function useSeatMap(slug: string, plan: SeatPlan): SeatMapModel {
  const [selectedSeatIds, dispatch] = useReducer(selectionReducer, []);
  const [conflict, setConflict] = useState<SeatConflict | null>(null);
  const { data, error, refetch } = useQuery({
    ...seatQueries.availability(slug),
    refetchInterval: AVAILABILITY_REFRESH_MS,
  });

  const unavailableSeatIds = useMemo(() => (data ? new Set(data.unavailableSeatIds) : NO_SEATS), [data]);
  const selection = useMemo(
    () => deriveSelection(plan, selectedSeatIds, unavailableSeatIds),
    [plan, selectedSeatIds, unavailableSeatIds],
  );

  const hold = useReserveHold((problem) => {
    switch (problem.code) {
      case "seats_unavailable":
        dispatch({ type: "remove", seatIds: problem.seatIds });
        setConflict({ title: "Someone got there first", detail: problem.detail });
        break;
      case "single_seat_gap":
        setConflict({ title: "That would leave a seat on its own", detail: problem.detail });
        break;
      default:
        setConflict({ title: "Couldn’t reserve those seats", detail: problem.detail });
    }
  });

  const availability: SeatAvailability = shouldShowQueryError(data, error)
    ? { kind: "load-error", retry: () => void refetch() }
    : data
      ? { kind: "ready", unavailableSeatIds }
      : { kind: "loading" };
  const isReady = availability.kind === "ready";

  const toggle = useCallback(
    (seatId: string) => {
      if (!isReady || unavailableSeatIds.has(seatId)) return;
      setConflict(null);
      dispatch({ type: "toggle", seatId });
    },
    [isReady, unavailableSeatIds],
  );

  return {
    availability,
    selection,
    toggle,
    remove: (seatId) => {
      dispatch({ type: "remove", seatIds: [seatId] });
    },
    dismissLostSeats: () => {
      dispatch({ type: "remove", seatIds: selection.lostSeats.map((seat) => seat.id) });
    },
    reserve: () => {
      setConflict(null);
      dispatch({ type: "remove", seatIds: selection.lostSeats.map((seat) => seat.id) });
      hold.reserve({ eventSlug: slug, seatIds: selection.seats.map((seat) => seat.id) });
    },
    canReserve:
      isReady &&
      selection.seats.length > 0 &&
      selection.gapSeats.length === 0 &&
      !hold.isReserving &&
      hold.retryAtMs === null,
    isReserving: hold.isReserving,
    retryAtMs: hold.retryAtMs,
    onRetryReady: hold.onRetryReady,
    // A problem has its own words; a request that never got an answer gets these.
    conflict:
      conflict ??
      (hold.error && !problemOf(hold.error)
        ? { title: "Couldn’t reserve those seats", detail: hold.error.message }
        : null),
  };
}
