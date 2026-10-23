"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { OrganiserOrderDto } from "@/contract/dto";
import { problemOf } from "@/lib/api-client";
import {
  describePayment,
  describeTaxLine,
  formatEventDate,
  formatEventTime,
  formatMoney,
  formatSeat,
} from "@/lib/format";
import { organiserQueries, shouldShowQueryError } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { pollIntervalFor, useLiveUpdates } from "@/features/organiser/hooks/use-live-updates";
import { RefundAction } from "./refund-action";

const STATUS_LABELS: Record<OrganiserOrderDto["status"], string> = {
  pending: "Pending",
  paid: "Paid, tickets on their way",
  fulfilled: "Fulfilled",
  failed: "Payment failed",
  expired: "Expired before payment",
  refunded: "Refunded",
};

const REFUND_REASONS: Record<OrganiserOrderDto["refunds"][number]["reason"], string> = {
  requested_by_customer: "The buyer asked",
  event_changed: "The event changed",
  duplicate: "A duplicate order",
  other: "Another reason",
};

export function orderStatusText(order: Pick<OrganiserOrderDto, "status" | "refundStatus">) {
  return order.refundStatus === "pending" ? "Refund pending" : STATUS_LABELS[order.status];
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-ink-2">{term}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** One order as its organiser sees it. Another organiser's isn't found — not even confirmed to exist. */
export function OrderDetail({ orderId }: { orderId: string }) {
  // Re-read on every change while the stream is live; polled, as the overview is, while
  // it's down. An order that isn't there won't appear, so it isn't asked for again.
  const { status } = useLiveUpdates();
  const query = useQuery({
    ...organiserQueries.order(orderId),
    refetchInterval: (current) =>
      problemOf(current.state.error)?.code === "not_found" ? false : pollIntervalFor(status),
  });
  const account = useQuery(organiserQueries.account());
  const canRefund = account.data?.permissions.includes("orders:refund") ?? false;
  const order = query.data;

  if (shouldShowQueryError(order, query.error)) {
    const isNotFound = problemOf(query.error)?.code === "not_found";
    return (
      <Notice tone="bad" title={isNotFound ? "That order isn’t here" : "Couldn’t load the order"} role="alert">
        {isNotFound
          ? "It doesn’t exist, or it belongs to another organiser. "
          : "Check your connection and try again. "}
        <Link href={routes.organiserOrders()} className="underline underline-offset-4">
          Back to orders
        </Link>
      </Notice>
    );
  }
  if (!order) {
    return (
      <div className="flex justify-center py-16 text-ink-3" role="status">
        <Spinner className="size-5" />
        <span className="sr-only">Loading the order…</span>
      </div>
    );
  }

  const { currency } = order;
  return (
    <div className="space-y-6">
      <div>
        <Link href={routes.organiserOrders()} className="text-sm text-ink-2 underline-offset-4 hover:underline">
          ← All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Order <span className="font-mono text-2xl">{order.id}</span>
            </h1>
            <p className="mt-1 text-ink-2">
              {order.eventName} · placed {formatEventDate(order.createdAt, "Asia/Kolkata")},{" "}
              {formatEventTime(order.createdAt, "Asia/Kolkata")}
            </p>
          </div>
          {canRefund && <RefundAction order={order} />}
        </div>
      </div>

      <p role="status" className="inline-flex rounded-full border border-line bg-card px-3 py-1 text-sm font-medium">
        {orderStatusText(order)}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="buyer-title" className="rounded-xl border border-line bg-card p-5">
          <h2 id="buyer-title" className="font-display text-lg font-semibold">
            Who it’s for
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.attendees.map((attendee, i) => (
              <li key={`${attendee.email}-${String(i)}`}>
                {attendee.name} <span className="text-ink-3">· {attendee.email}</span>
                {order.seats[i] && <span className="block text-ink-2">{formatSeat(order.seats[i])}</span>}
              </li>
            ))}
          </ul>
          <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
            {order.items.map((item) => (
              <Row key={item.tierId} term={item.tierName}>
                × {item.quantity}
              </Row>
            ))}
            {order.addOns.map((addOn) => (
              <Row key={addOn.id} term={addOn.name}>
                × {addOn.quantity}
              </Row>
            ))}
            {order.paymentMethod && (
              <Row term="Paid">{describePayment({ method: order.paymentMethod, last4: order.last4 })}</Row>
            )}
          </dl>
        </section>

        <section aria-labelledby="money-title" className="rounded-xl border border-line bg-card p-5">
          <h2 id="money-title" className="font-display text-lg font-semibold">
            What it cost
          </h2>
          <dl className="mt-3 divide-y divide-line text-sm tabular-nums">
            <Row term="Tickets">{formatMoney(order.amounts.ticketsMinor, currency)}</Row>
            {order.amounts.addOnsMinor > 0 && (
              <Row term="Extras">{formatMoney(order.amounts.addOnsMinor, currency)}</Row>
            )}
            <Row term="Booking fee">{formatMoney(order.amounts.feesMinor, currency)}</Row>
            {order.amounts.taxLines.map((line) => (
              <Row key={`${line.kind}-${String(line.rateBasisPoints)}`} term={describeTaxLine(line, currency)}>
                {formatMoney(line.amountMinor, currency)}
              </Row>
            ))}
            <Row term="Total">
              <span className="font-medium">{formatMoney(order.totalMinor, currency)}</span>
            </Row>
          </dl>
          {order.refunds.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-sm font-medium">Refunds</h3>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {order.refunds.map((refund) => (
                  <li key={refund.id}>
                    {formatMoney(refund.amountMinor, refund.currency)} · {REFUND_REASONS[refund.reason]} ·{" "}
                    {refund.status === "pending" ? "on its way" : "refunded"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
