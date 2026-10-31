"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getEvent, getSeatPlan } from "@/core/catalog";
import { allInTicketPriceMinor, priceOrder } from "@/core/pricing";
import { formatSeatList, type Seat } from "@/core/seating";
import { MAX_TICKETS_PER_ORDER } from "@/core/ticketing";
import { formatMoney } from "@/lib/format";
import { Notice } from "@/components/ui/notice";
import { RetryNotice } from "@/components/ui/retry-notice";
import { tierTones } from "@/features/events/domain/tier-tones";
import { useSeatMap } from "@/features/events/hooks/use-seat-map";
import type { SeatCellState } from "./seat-cell";
import { SeatGrid, type TierLabels } from "./seat-grid";
import { SeatLegend, type TierKey } from "./seat-legend";
import { SelectedSeats } from "./selected-seats";

const LOST_SEATS_TITLE = "Someone else just took a seat you chose";

const SEAT_SIZE_OPTIONS = ["small", "medium", "large"] as const;
type SeatSize = (typeof SEAT_SIZE_OPTIONS)[number];

/** Every size is at least 24 px, WCAG 2.2's minimum target (SC 2.5.8). */
const SEAT_SIZES: Record<SeatSize, string> = { small: "28px", medium: "36px", large: "44px" };

function SeatSizeControl({ value, onChange }: { value: SeatSize; onChange: (size: SeatSize) => void }) {
  return (
    <fieldset className="flex items-center gap-3 text-sm">
      <legend className="float-left mr-1 text-ink-3">Seat size</legend>
      <div className="flex rounded-lg border border-line bg-card p-0.5">
        {SEAT_SIZE_OPTIONS.map((size) => (
          <label
            key={size}
            className="cursor-pointer rounded-md px-3 py-1.5 capitalize has-checked:bg-ink has-checked:text-paper has-focus-visible:ring-2 has-focus-visible:ring-accent"
          >
            <input
              type="radio"
              name="seat-size"
              value={size}
              checked={value === size}
              onChange={() => onChange(size)}
              className="sr-only"
            />
            {size}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Reserved seating: the hall, drawn from static data and server-rendered, so there's
 * no layout shift; which seats are gone arrives from the API and is polled. One grid
 * per section, a polite running count of the choice, and the server's word on any
 * conflict — focused, so it's read straight away.
 */
export function SeatMap({ slug }: { slug: string }) {
  const event = getEvent(slug);
  const plan = getSeatPlan(slug);
  const model = useSeatMap(slug, plan);
  const [seatSize, setSeatSize] = useState<SeatSize>("small");
  const conflictNotice = useRef<HTMLDivElement>(null);
  const { availability, selection, conflict } = model;

  const tiers: TierLabels = useMemo(
    () =>
      new Map(
        event.tiers.map((tier) => [
          tier.id,
          { name: tier.name, price: formatMoney(allInTicketPriceMinor(event, tier.id), event.currency) },
        ]),
      ),
    [event],
  );
  // Each tier has its colour on the map, dearest first; the legend says which rows, in words.
  const tones = useMemo(() => tierTones(event.tiers), [event]);
  const tierKeys: TierKey[] = event.tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    price: formatMoney(allInTicketPriceMinor(event, tier.id), event.currency),
    description: tier.description,
    tone: tones.get(tier.id) ?? 3,
  }));
  const selectedSeatIds = useMemo(() => new Set(selection.seats.map((seat) => seat.id)), [selection.seats]);
  const unavailable = availability.kind === "ready" ? availability.unavailableSeatIds : null;
  const stateOf = (seat: Seat): SeatCellState =>
    !unavailable ? "loading" : unavailable.has(seat.id) ? "taken" : selectedSeatIds.has(seat.id) ? "selected" : "free";

  useEffect(() => {
    if (conflict) conflictNotice.current?.focus();
  }, [conflict]);

  // All in, from the same engine the order is charged with.
  const totalMinor = priceOrder(
    event,
    event.tiers.flatMap((tier) => {
      const quantity = selection.seats.filter((seat) => seat.tierId === tier.id).length;
      return quantity > 0 ? [{ tierId: tier.id, quantity }] : [];
    }),
    {},
  ).totalMinor;
  const { lostSeats } = selection;
  const lostSeatsMessage =
    lostSeats.length > 0
      ? `${formatSeatList(lostSeats)} ${lostSeats.length === 1 ? "is" : "are"} gone; your other seats are still chosen.`
      : null;
  const chosenCount = selection.seats.length;
  const announcement =
    chosenCount === 0
      ? "No seats chosen."
      : `${chosenCount} of ${MAX_TICKETS_PER_ORDER} seats chosen: ${formatSeatList(selection.seats)}.`;
  const sizeStyle: CSSProperties & Record<"--seat-size", string> = { "--seat-size": SEAT_SIZES[seatSize] };

  return (
    <section aria-labelledby="seat-map-title" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="seat-map-title" className="font-display text-2xl font-semibold tracking-tight">
            Choose your seats
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            Arrow keys move around a section, Space chooses a seat, and Tab moves to the next section.
          </p>
        </div>
        <SeatSizeControl value={seatSize} onChange={setSeatSize} />
      </div>

      <div className="mt-4">
        <SeatLegend tiers={tierKeys} />
      </div>

      <div className="mt-4 space-y-3">
        {availability.kind === "load-error" && (
          <Notice tone="bad" title="Couldn’t load which seats are free" role="alert">
            <button type="button" className="underline underline-offset-4" onClick={availability.retry}>
              Try again
            </button>
          </Notice>
        )}
        {lostSeatsMessage && (
          <Notice tone="warn" title={LOST_SEATS_TITLE}>
            {lostSeatsMessage}{" "}
            <button type="button" className="underline underline-offset-4" onClick={model.dismissLostSeats}>
              OK
            </button>
          </Notice>
        )}
        <RetryNotice retryAtMs={model.retryAtMs} onReady={model.onRetryReady} />
        {conflict && (
          <div ref={conflictNotice} tabIndex={-1} className="outline-none">
            <Notice tone="bad" title={conflict.title} role="alert">
              {conflict.detail}
            </Notice>
          </div>
        )}
      </div>

      {/* On wide screens the hall breaks out of the text column, so it fits without scrolling. */}
      <div className="mt-4 xl:-mx-24">
        <div
          style={sizeStyle}
          className="overflow-x-auto overscroll-x-contain rounded-xl border border-line bg-card px-4 py-5"
        >
          <div className="mx-auto w-max space-y-8">
            <p className="rounded-md bg-sunk py-1.5 text-center text-xs tracking-[0.25em] text-ink-3 uppercase">
              Stage
            </p>
            {plan.sections.map((section) => (
              <SeatGrid
                key={section.id}
                section={section}
                stateOf={stateOf}
                tiers={tiers}
                tones={tones}
                onToggle={model.toggle}
                isLoading={!unavailable}
              />
            ))}
          </div>
        </div>
        <SelectedSeats
          seats={selection.seats}
          gapSeats={selection.gapSeats}
          totalLabel={formatMoney(totalMinor, event.currency)}
          onRemove={model.remove}
          onReserve={model.reserve}
          canReserve={model.canReserve}
          isReserving={model.isReserving}
        />
      </div>

      {/* Live regions are mounted before they speak: one that arrives with its words isn't reliably read. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p role="status" className="sr-only">
        {lostSeatsMessage && `${LOST_SEATS_TITLE}. ${lostSeatsMessage}`}
      </p>
    </section>
  );
}
