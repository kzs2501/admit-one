"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { SalesMetricsDto } from "@/contract/dto";
import { formatCount, formatDuration, formatMoney, formatPercent } from "@/lib/format";
import { organiserQueries, shouldShowQueryError } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { pollIntervalFor, useLiveUpdates } from "@/features/organiser/hooks/use-live-updates";
import { SalesChart } from "./sales-chart";

function Kpis({ metrics }: { metrics: SalesMetricsDto }) {
  const { tickets, revenue, paidOrders, averageOrderMinor, webhookLag, currency } = metrics;
  const items = [
    {
      label: "Tickets sold",
      value: formatCount(tickets.sold),
      detail: `${formatPercent(tickets.sold, tickets.capacity)} of ${formatCount(tickets.capacity)}`,
    },
    {
      label: "Net revenue",
      value: formatMoney(revenue.netMinor, currency),
      detail: `${formatMoney(revenue.refundedMinor, currency)} refunded`,
    },
    {
      label: "Paid orders",
      value: formatCount(paidOrders),
      detail: `${formatMoney(averageOrderMinor, currency)} on average`,
    },
    {
      label: "Webhook lag",
      value: webhookLag.p50Ms === null ? "None yet" : formatDuration(webhookLag.p50Ms),
      detail: webhookLag.p95Ms === null ? "No payments yet" : `p95 ${formatDuration(webhookLag.p95Ms)}`,
    },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-card p-5">
          <dt className="text-sm text-ink-2">{item.label}</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{item.value}</dd>
          <dd className="mt-0.5 text-sm text-ink-3">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Each stage counts orders that got at least that far. A list with numbers, and bars only for the eye. */
function Funnel({ funnel }: { funnel: SalesMetricsDto["funnel"] }) {
  const stages = [
    { label: "Reserved", count: funnel.holds },
    { label: "Ordered", count: funnel.orders },
    { label: "Paid", count: funnel.paid },
    { label: "Fulfilled, not refunded", count: funnel.fulfilled },
  ];
  return (
    <section aria-labelledby="funnel-title" className="rounded-xl border border-line bg-card p-5">
      <h2 id="funnel-title" className="font-display text-lg font-semibold">
        From reservation to ticket
      </h2>
      <ol className="mt-4 space-y-3 text-sm">
        {stages.map((stage) => (
          <li key={stage.label}>
            <div className="flex justify-between gap-3">
              <span>{stage.label}</span>
              <span className="tabular-nums">
                {formatCount(stage.count)}{" "}
                <span className="text-ink-3">({formatPercent(stage.count, funnel.holds)} of reservations)</span>
              </span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-sunk">
              <div className="h-2 rounded-full bg-accent" style={{ width: formatPercent(stage.count, funnel.holds) }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PaymentMix({ metrics }: { metrics: SalesMetricsDto }) {
  return (
    <section aria-labelledby="mix-title" className="rounded-xl border border-line bg-card p-5">
      <h2 id="mix-title" className="font-display text-lg font-semibold">
        How buyers paid
      </h2>
      <ul className="mt-4 space-y-3 text-sm">
        {metrics.paymentMethods.map(({ method, orders }) => (
          <li key={method}>
            <div className="flex justify-between gap-3">
              <span>{method === "upi" ? "UPI" : "Card"}</span>
              <span className="tabular-nums">
                {formatCount(orders)} <span className="text-ink-3">({formatPercent(orders, metrics.paidOrders)})</span>
              </span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-sunk">
              <div className="h-2 rounded-full bg-ink-2" style={{ width: formatPercent(orders, metrics.paidOrders) }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sold against capacity per tier, as native meters: their value and range are announced as they are. */
function Tiers({ metrics }: { metrics: SalesMetricsDto }) {
  return (
    <section aria-labelledby="tiers-title" className="rounded-xl border border-line bg-card p-5">
      <h2 id="tiers-title" className="font-display text-lg font-semibold">
        Tickets by type
      </h2>
      <ul className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        {metrics.tiers.map((tier) => {
          const id = `tier-${tier.tierId}`;
          return (
            <li key={tier.tierId}>
              <div className="flex justify-between gap-3">
                <label htmlFor={id}>
                  {tier.tierName} <span className="text-ink-3">· {tier.eventName}</span>
                </label>
                <span className="tabular-nums">
                  {formatCount(tier.sold)} of {formatCount(tier.capacity)}
                </span>
              </div>
              <meter id={id} min={0} max={tier.capacity} value={tier.sold} className="mt-1.5 block h-2 w-full" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Sales at a glance: across the account's events, or for the one chosen (`?event=`, so the view can be shared). */
export function Overview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventSlug = searchParams.get("event") ?? undefined;
  const { status } = useLiveUpdates();
  const events = useQuery(organiserQueries.events());
  const metrics = useQuery({ ...organiserQueries.metrics(eventSlug), refetchInterval: pollIntervalFor(status) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Overview</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Show</span>
          <select
            value={eventSlug ?? ""}
            onChange={(change) => {
              router.replace(routes.organiser(change.target.value || undefined), { scroll: false });
            }}
            className="min-h-10 rounded-lg border border-line bg-card px-3"
          >
            <option value="">All your events</option>
            {events.data?.map((event) => (
              <option key={event.slug} value={event.slug}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shouldShowQueryError(metrics.data, metrics.error) ? (
        <Notice tone="bad" title="Couldn’t load the numbers" role="alert">
          Check your connection, then{" "}
          <button type="button" onClick={() => void metrics.refetch()} className="underline underline-offset-4">
            try again
          </button>
          .
        </Notice>
      ) : !metrics.data ? (
        <div className="flex justify-center py-16 text-ink-3" role="status">
          <Spinner className="size-5" />
          <span className="sr-only">Loading the numbers…</span>
        </div>
      ) : (
        <>
          <Kpis metrics={metrics.data} />
          <SalesChart metrics={metrics.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Funnel funnel={metrics.data.funnel} />
            <PaymentMix metrics={metrics.data} />
          </div>
          <Tiers metrics={metrics.data} />
        </>
      )}
    </div>
  );
}
