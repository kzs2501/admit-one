import type { EventView, LineItem } from "@/contract/dto";
import { formatMoney, priceOrder } from "@/core/money";
import { formatEventDate, formatEventTime } from "@/lib/format";

/**
 * The running order summary. It's priced with the same function the server uses
 * (`priceOrder`), so the total shown here is the total that gets charged.
 */
export function OrderSummary({
  event,
  items,
  addOns,
}: {
  event: EventView;
  items: LineItem[];
  addOns: Record<string, number>;
}) {
  const amounts = priceOrder(event, items, Object.fromEntries(Object.entries(addOns).filter(([, q]) => q > 0)));
  const rows = [
    ...items.map(({ tierId, qty }) => {
      const tier = event.tiers.find((t) => t.id === tierId)!;
      return { key: tierId, label: `${qty} × ${tier.name}`, cents: tier.priceCents * qty };
    }),
    ...Object.entries(addOns)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => {
        const addOn = event.addOns.find((a) => a.id === id)!;
        return { key: id, label: `${qty} × ${addOn.name}`, cents: addOn.priceCents * qty };
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
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between gap-4">
            <dt className="text-ink-2">{r.label}</dt>
            <dd className="tabular">{formatMoney(r.cents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Service fee (3%)</dt>
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
