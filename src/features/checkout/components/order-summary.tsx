import type { EventDto, SeatDto } from "@/contract/dto";
import { priceOrder, SERVICE_FEE_LABEL } from "@/core/money";
import type { LineItem } from "@/core/ticketing";
import { formatEventDate, formatEventTime, formatMoney, formatSeats } from "@/lib/format";

/**
 * The running order summary. It's priced with the same function the server uses
 * (`priceOrder`), so the total shown here is the total that gets charged.
 */
export function OrderSummary({
  event,
  items,
  seats,
  addOns,
}: {
  event: EventDto;
  items: LineItem[];
  /** Reserved seating: the seats held, listed under their tier. */
  seats: readonly SeatDto[];
  addOns: Record<string, number>;
}) {
  const chosenAddOns = Object.fromEntries(Object.entries(addOns).filter(([, quantity]) => quantity > 0));
  const amounts = priceOrder(event, items, chosenAddOns);
  const rows = [
    ...items.map(({ tierId, quantity }) => {
      const tier = event.tiers.find((candidate) => candidate.id === tierId);
      const tierSeats = seats.filter((seat) => seat.tierId === tierId);
      return {
        key: tierId,
        label: `${quantity} × ${tier?.name ?? tierId}`,
        detail: tierSeats.length > 0 ? formatSeats(tierSeats) : null,
        amountMinor: (tier?.priceMinor ?? 0) * quantity,
      };
    }),
    ...Object.entries(chosenAddOns).map(([addOnId, quantity]) => {
      const addOn = event.addOns.find((candidate) => candidate.id === addOnId);
      return {
        key: addOnId,
        label: `${quantity} × ${addOn?.name ?? addOnId}`,
        detail: null,
        amountMinor: (addOn?.priceMinor ?? 0) * quantity,
      };
    }),
  ];

  return (
    <aside aria-labelledby="summary-title" className="rounded-xl border border-line bg-card p-5">
      <h2 id="summary-title" className="font-display font-semibold">
        {event.name}
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        {formatEventDate(event.startsAt, event.timeZone)} · {formatEventTime(event.startsAt, event.timeZone)} ·{" "}
        {event.city}
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-4">
            <dt className="text-ink-2">
              {row.label}
              {row.detail && <span className="block text-xs text-ink-3">{row.detail}</span>}
            </dt>
            <dd className="tabular">{formatMoney(row.amountMinor, amounts.currency)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Service fee ({SERVICE_FEE_LABEL})</dt>
          <dd className="tabular">{formatMoney(amounts.feesMinor, amounts.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-3 font-medium">
          <dt>Total</dt>
          <dd className="tabular">{formatMoney(amounts.totalMinor, amounts.currency)}</dd>
        </div>
      </dl>
    </aside>
  );
}
