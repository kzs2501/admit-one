"use client";

import { useQuery } from "@tanstack/react-query";
import { getEvent } from "@/core/catalog";
import { priceOrder, ticketPrice } from "@/core/pricing";
import { MAX_TICKETS_PER_ORDER, stockLevel, type StockLevel } from "@/core/ticketing";
import { formatMoney } from "@/lib/format";
import { eventQueries, shouldShowQueryError } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RetryNotice } from "@/components/ui/retry-notice";
import { Stepper } from "@/components/ui/stepper";
import { useReserveTickets } from "@/features/events/hooks/use-reserve-tickets";

/** Availability changes while the page is open; refresh it this often. */
const AVAILABILITY_REFRESH_MS = 5_000;

const STOCK_TONES: Record<StockLevel, string> = { "sold-out": "text-bad", low: "text-warn", plenty: "text-ink-3" };

/**
 * Choose tickets and reserve them. The tiers — names, descriptions, prices — are static
 * content and render at once, server-side, so nothing moves when the live part arrives:
 * how many are left, which can change while you look.
 */
export function TierPicker({ slug }: { slug: string }) {
  const event = getEvent(slug);
  const {
    data: live,
    error,
    refetch,
  } = useQuery({ ...eventQueries.detail(slug), refetchInterval: AVAILABILITY_REFRESH_MS });
  const availableFor = (tierId: string) => live?.tiers.find((tier) => tier.id === tierId)?.available;
  const { quantities, setQuantity, soldOutNotice, reserve, isReserving, reserveError, retryAtMs, onRetryReady } =
    useReserveTickets(slug);

  if (shouldShowQueryError(live, error)) {
    return (
      <Notice tone="bad" title="Couldn’t load tickets" role="alert">
        <button className="underline underline-offset-4" onClick={() => void refetch()}>
          Try again
        </button>
      </Notice>
    );
  }

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const chosenItems = event.tiers.flatMap((tier) => {
    const quantity = quantities[tier.id] ?? 0;
    return quantity > 0 ? [{ tierId: tier.id, quantity }] : [];
  });
  // All in: the same total the order will charge, fees and GST included.
  const totalMinor = priceOrder(event, chosenItems, {}).totalMinor;
  const isSoldOut = live !== undefined && event.tiers.every((tier) => availableFor(tier.id) === 0);

  return (
    <form
      aria-busy={live === undefined || undefined}
      className="rounded-xl border border-line bg-card"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        reserve();
      }}
    >
      <ul className="divide-y divide-line">
        {event.tiers.map((tier) => {
          const chosen = quantities[tier.id] ?? 0;
          const available = availableFor(tier.id);
          const max = Math.min(available ?? 0, MAX_TICKETS_PER_ORDER - (total - chosen));
          const level = available === undefined ? null : stockLevel(available);
          const price = ticketPrice(tier.priceMinor);
          return (
            <li key={tier.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-medium">{tier.name}</p>
                <p className="text-sm text-ink-2">{tier.description}</p>
                <p className="mt-1 text-sm">
                  <span className="tabular font-medium">{formatMoney(price.allInMinor, event.currency)}</span>
                  <span className={`tabular ml-2 text-xs ${level ? STOCK_TONES[level] : "text-ink-3"}`}>
                    {available === undefined ? "Checking…" : level === "sold-out" ? "Sold out" : `${available} left`}
                  </span>
                </p>
                <p className="tabular mt-0.5 text-xs text-ink-3">
                  Ticket {formatMoney(price.baseMinor, event.currency)} + booking fee{" "}
                  {formatMoney(price.feeMinor, event.currency)}
                  {price.isGstExempt
                    ? ` + GST on the fee ${formatMoney(price.gstOnFeeMinor, event.currency)} (no GST on the ticket)`
                    : ` + GST ${formatMoney(price.gstOnTicketMinor + price.gstOnFeeMinor, event.currency)}`}
                </p>
              </div>
              <Stepper
                label={tier.name}
                value={chosen}
                max={Math.max(0, max)}
                onChange={(quantity) => {
                  setQuantity(tier.id, quantity);
                }}
                isDisabled={!available || isReserving}
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
        {retryAtMs !== null && <RetryNotice retryAtMs={retryAtMs} onReady={onRetryReady} />}
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
                <span className="tabular font-medium text-ink">{formatMoney(totalMinor, event.currency)}</span> all in
              </>
            )}
          </p>
          <Button type="submit" disabled={total === 0 || isSoldOut || retryAtMs !== null} isBusy={isReserving}>
            {isSoldOut
              ? "Sold out"
              : isReserving
                ? "Reserving…"
                : event.seating.kind === "reserved"
                  ? "Find the best seats"
                  : "Reserve tickets"}
          </Button>
        </div>
        {!isSoldOut && <p className="text-xs text-ink-3">We’ll hold them for you while you check out.</p>}
      </div>
    </form>
  );
}
