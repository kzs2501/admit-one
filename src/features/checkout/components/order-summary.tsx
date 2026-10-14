import type { EventDto } from "@/contract/dto";
import { priceOrder, SERVICE_FEE_LABEL } from "@/core/money";
import type { LineItem } from "@/core/ticketing";
import { formatEventDate, formatEventTime, formatMoney } from "@/lib/format";

/**
 * The running order summary. It's priced with the same function the server uses
 * (`priceOrder`), so the total shown here is the total that gets charged.
 */
export function OrderSummary({
  event,
  items,
  addOns,
}: {
  event: EventDto;
  items: LineItem[];
  addOns: Record<string, number>;
}) {
  const chosenAddOns = Object.fromEntries(Object.entries(addOns).filter(([, quantity]) => quantity > 0));
  const amounts = priceOrder(event, items, chosenAddOns);
  const rows = [
    ...items.map(({ tierId, quantity }) => {
      const tier = event.tiers.find((candidate) => candidate.id === tierId);
      return {
        key: tierId,
        label: `${quantity} × ${tier?.name ?? tierId}`,
        cents: (tier?.priceCents ?? 0) * quantity,
      };
    }),
    ...Object.entries(chosenAddOns).map(([addOnId, quantity]) => {
      const addOn = event.addOns.find((candidate) => candidate.id === addOnId);
      return {
        key: addOnId,
        label: `${quantity} × ${addOn?.name ?? addOnId}`,
        cents: (addOn?.priceCents ?? 0) * quantity,
      };
    }),
  ];

  return (
    <aside aria-labelledby="summary-title" className="rounded-xl border border-line bg-card p-5">
      <h2 id="summary-title" className="font-display font-semibold">
        {event.name}
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        {formatEventDate(event.startsAt)} · {formatEventTime(event.startsAt)} · {event.city}
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-4">
            <dt className="text-ink-2">{row.label}</dt>
            <dd className="tabular">{formatMoney(row.cents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Service fee ({SERVICE_FEE_LABEL})</dt>
          <dd className="tabular">{formatMoney(amounts.feesCents)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-3 font-medium">
          <dt>Total</dt>
          <dd className="tabular">{formatMoney(amounts.totalCents)}</dd>
        </div>
      </dl>
    </aside>
  );
}
