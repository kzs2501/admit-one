"use client";

import { useQuery } from "@tanstack/react-query";
import { MAX_TICKETS_PER_ORDER, stockLevel, type StockLevel } from "@/core/ticketing";
import { formatMoney } from "@/lib/format";
import { eventQueries, shouldShowQueryError } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Stepper } from "@/components/ui/stepper";
import { useReserveTickets } from "@/features/events/hooks/use-reserve-tickets";

/** Availability changes while the page is open; refresh it this often. */
const AVAILABILITY_REFRESH_MS = 5_000;

const STOCK_TONES: Record<StockLevel, string> = { "sold-out": "text-bad", low: "text-warn", plenty: "text-ink-3" };

/** Choose tickets and reserve them. Availability is live: it can change while you look. */
export function TierPicker({ slug }: { slug: string }) {
  const {
    data: event,
    error,
    refetch,
  } = useQuery({ ...eventQueries.detail(slug), refetchInterval: AVAILABILITY_REFRESH_MS });
  const { quantities, setQuantity, soldOutNotice, reserve, isReserving, reserveError } = useReserveTickets(slug);

  if (shouldShowQueryError(event, error)) {
    return (
      <Notice tone="bad" title="Couldn’t load tickets" role="alert">
        <button className="underline underline-offset-4" onClick={() => void refetch()}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!event) {
    return <div aria-busy="true" aria-label="Loading tickets" className="h-56 rounded-xl border border-line bg-card" />;
  }

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const subtotalMinor = event.tiers.reduce((sum, tier) => sum + tier.priceMinor * (quantities[tier.id] ?? 0), 0);
  const isSoldOut = event.tiers.every((tier) => tier.available === 0);

  return (
    <form
      className="rounded-xl border border-line bg-card"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        reserve();
      }}
    >
      <ul className="divide-y divide-line">
        {event.tiers.map((tier) => {
          const chosen = quantities[tier.id] ?? 0;
          const max = Math.min(tier.available, MAX_TICKETS_PER_ORDER - (total - chosen));
          const level = stockLevel(tier.available);
          return (
            <li key={tier.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-medium">{tier.name}</p>
                <p className="text-sm text-ink-2">{tier.description}</p>
                <p className="mt-1 text-sm">
                  <span className="tabular font-medium">{formatMoney(tier.priceMinor, event.currency)}</span>
                  <span className={`tabular ml-2 text-xs ${STOCK_TONES[level]}`}>
                    {level === "sold-out" ? "Sold out" : `${tier.available} left`}
                  </span>
                </p>
              </div>
              <Stepper
                label={tier.name}
                value={chosen}
                max={Math.max(0, max)}
                onChange={(quantity) => {
                  setQuantity(tier.id, quantity);
                }}
                isDisabled={tier.available === 0 || isReserving}
              />
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-line p-5">
        {soldOutNotice && (
          <Notice tone="warn" title="Just missed it" role="alert">
            {soldOutNotice} The numbers above are up to date.
          </Notice>
        )}
        {reserveError && (
          <Notice tone="bad" title="Couldn’t reserve those tickets" role="alert">
            {reserveError.message}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2" aria-live="polite">
            {total === 0 ? (
              isSoldOut ? (
                "This event is sold out."
              ) : (
                `Choose up to ${MAX_TICKETS_PER_ORDER} tickets.`
              )
            ) : (
              <>
                {total} ticket{total === 1 ? "" : "s"} ·{" "}
                <span className="tabular font-medium text-ink">{formatMoney(subtotalMinor, event.currency)}</span>
              </>
            )}
          </p>
          <Button type="submit" disabled={total === 0 || isSoldOut} isBusy={isReserving}>
            {isSoldOut ? "Sold out" : isReserving ? "Reserving…" : "Reserve tickets"}
          </Button>
        </div>
        {!isSoldOut && <p className="text-xs text-ink-3">We’ll hold them for you while you check out.</p>}
      </div>
    </form>
  );
}
