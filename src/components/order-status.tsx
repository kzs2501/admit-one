"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { OrderView } from "@/shared/api-types";
import { getEventInfo } from "@/shared/catalog";
import { formatMoney } from "@/shared/money";
import { api, ApiError } from "@/lib/api";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { stepHref } from "@/checkout/registry";
import { Notice, Spinner } from "./ui";

/** Statuses that need nothing more from the server — stop polling. */
const SETTLED: OrderView["status"][] = ["fulfilled", "refunded", "expired", "failed"];

/** 0.5s, 1s, 2s, then every 4s: fast when it's likely to finish, gentle when it isn't. */
export const pollDelay = (attempt: number) => Math.min(4_000, 500 * 2 ** attempt);

const SLOW_AFTER_MS = 8_000;

/** Pending, but nothing is in flight: the buyer hasn't paid (or abandoned 3-D Secure). */
const isUnpaid = (o: OrderView) =>
  o.status === "pending" && (!o.payment || o.payment.status === "requires_action" || o.payment.status === "failed");

/** Only worth polling while a payment is genuinely in flight. */
const isWaiting = (o: OrderView) => !SETTLED.includes(o.status) && !isUnpaid(o);

/**
 * The order page — where the browser lands after paying. It never assumes the
 * payment worked just because we got here: it polls until the webhook has settled
 * the order, however long that takes, and whichever arrived first.
 */
export function OrderStatus({ orderId }: { orderId: string }) {
  const [slow, setSlow] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api.getOrder(orderId),
    refetchInterval: (q) => (q.state.data && !isWaiting(q.state.data) ? false : pollDelay(q.state.dataUpdateCount)),
  });
  const order = query.data;
  const waiting = order ? isWaiting(order) : false;

  // Reassure after a while; the clock starts when waiting does.
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  // When the outcome arrives, move focus to it so it's announced and in view.
  const status = order?.status;
  useEffect(() => {
    if (status && SETTLED.includes(status)) heading.current?.focus();
  }, [status]);

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Shell>
        <Notice tone="bad" title={missing ? "We can’t find that order" : "Couldn’t load your order"} role="alert">
          {missing ? "It may belong to another tab, or the sandbox was reset." : "We’ll keep trying."}{" "}
          <Link href="/" className="underline underline-offset-4">
            Browse events
          </Link>
        </Notice>
      </Shell>
    );
  }

  if (!order) {
    return (
      <Shell>
        <div className="grid min-h-[40vh] place-items-center">
          <Spinner label="Loading your order" className="size-6 text-ink-3" />
        </div>
      </Shell>
    );
  }

  const event = getEventInfo(order.eventSlug)!;

  if (isUnpaid(order)) {
    return (
      <Shell>
        <Outcome headingRef={heading} tone="warn" title="This order isn’t paid yet" reason={null}>
          <Link href={stepHref(order.holdId, "payment")} className="underline underline-offset-4">
            Continue to payment
          </Link>
        </Outcome>
      </Shell>
    );
  }

  if (waiting) {
    return (
      <Shell>
        <div role="status" aria-live="polite" className="py-10 text-center">
          <Spinner className="mx-auto size-8 text-accent" />
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">Confirming your payment…</h1>
          <p className="mt-3 text-ink-2">
            We’re waiting for your bank to confirm {formatMoney(order.amounts.totalCents)}. This page updates on its own.
          </p>
          {slow && (
            <p className="mx-auto mt-6 max-w-md rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-2">
              This is taking longer than usual. Your payment is safe — you won’t be charged twice, and you don’t need to
              do anything.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {order.status === "fulfilled" && (
        <>
          <p className="tabular text-xs tracking-[0.14em] text-ok uppercase">Payment confirmed</p>
          <h1 ref={heading} tabIndex={-1} className="mt-2 font-display text-3xl font-semibold tracking-tight outline-none">
            You’re going to {event.name}
          </h1>
          <p className="mt-2 text-ink-2">
            {formatEventDate(event.startsAt)} · {formatEventTime(event.startsAt)} · {event.venue}, {event.city}
          </p>
          <ul aria-label="Your tickets" className="mt-8 space-y-4">
            {order.tickets.map((t) => (
              <li key={t.code}>
                <TicketStub event={event.name} attendee={t.attendeeName} tier={t.tierName} code={t.code} />
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-ink-3">
            Paid {formatMoney(order.amounts.totalCents)} with a card ending {order.payment?.last4}. Order {order.id}.
          </p>
        </>
      )}

      {order.status === "refunded" && (
        <Outcome headingRef={heading} tone="warn" title="We refunded your payment" reason={order.statusReason}>
          <Link href={`/events/${order.eventSlug}`} className="underline underline-offset-4">
            Look for tickets again
          </Link>
        </Outcome>
      )}

      {order.status === "expired" && (
        <Outcome headingRef={heading} tone="bad" title="This reservation expired" reason={order.statusReason}>
          <Link href={`/events/${order.eventSlug}`} className="underline underline-offset-4">
            Look for tickets again
          </Link>
        </Outcome>
      )}

      {order.status === "failed" && (
        <Outcome headingRef={heading} tone="bad" title="Payment didn’t go through" reason={order.statusReason}>
          <Link href={stepHref(order.holdId, "payment")} className="underline underline-offset-4">
            Try another card
          </Link>{" "}
          — your tickets are still held for now.
        </Outcome>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">{children}</div>;
}

function Outcome({
  headingRef,
  tone,
  title,
  reason,
  children,
}: {
  headingRef: React.Ref<HTMLHeadingElement>;
  tone: "warn" | "bad";
  title: string;
  reason: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">
        {title}
      </h1>
      <div className="mt-5">
        <Notice tone={tone}>
          {reason && <p>{reason}</p>}
          <p className="mt-2">{children}</p>
        </Notice>
      </div>
    </div>
  );
}

/** A ticket, styled as one: main part, perforation, and a stub with the code. */
function TicketStub({ event, attendee, tier, code }: { event: string; attendee: string; tier: string; code: string }) {
  return (
    <article aria-label={`Ticket for ${attendee}`} className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="p-5">
        <p className="tabular text-[11px] tracking-[0.16em] text-ink-3 uppercase">Admit one</p>
        <p className="mt-1 font-display text-lg font-semibold">{event}</p>
        <p className="mt-1 text-sm text-ink-2">
          {attendee} · {tier}
        </p>
      </div>
      <div className="perforation mx-5" aria-hidden="true" />
      <div className="flex items-center justify-between gap-4 p-5">
        <span className="text-sm text-ink-3">Ticket code</span>
        <span className="tabular text-lg font-medium tracking-[0.2em]">{code}</span>
      </div>
    </article>
  );
}
