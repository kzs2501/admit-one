"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { getEvent } from "@/core/catalog";
import { formatEventDate, formatEventTime, formatMoney, formatSeat } from "@/lib/format";
import { routes } from "@/lib/routes";
import { ErrorState } from "@/components/ui/error-state";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useOrderStatus } from "@/features/orders/hooks/use-order-status";

/** The order page: renders whatever `useOrderStatus` says the order is doing. */
export function OrderStatusView({ orderId }: { orderId: string }) {
  const state = useOrderStatus(orderId);
  const heading = useRef<HTMLHeadingElement>(null);

  // When an outcome arrives, move focus to it so it's announced and in view.
  const isOutcome = ["fulfilled", "refunded", "expired", "failed"].includes(state.kind);
  useEffect(() => {
    if (isOutcome) heading.current?.focus();
  }, [isOutcome]);

  switch (state.kind) {
    case "loading":
      return (
        <Shell>
          <div className="grid min-h-[40vh] place-items-center">
            <Spinner label="Loading your order" className="size-6 text-ink-3" />
          </div>
        </Shell>
      );
    case "not-found":
      return (
        <ErrorState title="We can’t find that order">
          It may belong to another tab, or the sandbox was reset.
        </ErrorState>
      );
    case "load-error":
      return <ErrorState title="Couldn’t load your order">We’ll keep trying.</ErrorState>;
    case "awaiting-payment":
      return (
        <Shell>
          <Outcome headingRef={heading} tone="warn" title="This order isn’t paid yet" reason={null}>
            <Link href={routes.checkoutStep(state.order.holdId, "payment")} className="underline underline-offset-4">
              Continue to payment
            </Link>
          </Outcome>
        </Shell>
      );
    case "confirming":
      return (
        <Shell>
          <div role="status" aria-live="polite" className="py-10 text-center">
            <Spinner className="mx-auto size-8 text-accent" />
            <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">Confirming your payment…</h1>
            <p className="mt-3 text-ink-2">
              We’re waiting for your bank to confirm{" "}
              {formatMoney(state.order.amounts.totalMinor, state.order.amounts.currency)}. This page updates on its own.
            </p>
            {state.isSlow && (
              <p className="mx-auto mt-6 max-w-md rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-2">
                This is taking longer than usual. Your payment is safe — you won’t be charged twice, and you don’t need
                to do anything.
              </p>
            )}
          </div>
        </Shell>
      );
    case "fulfilled": {
      const { order } = state;
      const event = getEvent(order.eventSlug);
      return (
        <Shell>
          <p className="tabular text-xs tracking-[0.14em] text-ok uppercase">Payment confirmed</p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-2 font-display text-3xl font-semibold tracking-tight outline-none"
          >
            You’re going to {event.name}
          </h1>
          <p className="mt-2 text-ink-2">
            {formatEventDate(event.startsAt, event.timeZone)} · {formatEventTime(event.startsAt, event.timeZone)} ·{" "}
            {event.venue}, {event.city}
          </p>
          <ul aria-label="Your tickets" className="mt-8 space-y-4">
            {order.tickets.map((ticket) => (
              <li key={ticket.code}>
                <TicketStub
                  event={event.name}
                  attendee={ticket.attendeeName}
                  tier={ticket.tierName}
                  seat={ticket.seat ? formatSeat(ticket.seat) : null}
                  code={ticket.code}
                />
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-ink-3">
            Paid {formatMoney(order.amounts.totalMinor, order.amounts.currency)} with a card ending{" "}
            {order.payment?.last4}. Order {order.id}.
          </p>
        </Shell>
      );
    }
    case "refunded":
      return (
        <Shell>
          <Outcome headingRef={heading} tone="warn" title="We refunded your payment" reason={state.order.statusReason}>
            <Link href={routes.event(state.order.eventSlug)} className="underline underline-offset-4">
              Look for tickets again
            </Link>
          </Outcome>
        </Shell>
      );
    case "expired":
      return (
        <Shell>
          <Outcome headingRef={heading} tone="bad" title="This reservation expired" reason={state.order.statusReason}>
            <Link href={routes.event(state.order.eventSlug)} className="underline underline-offset-4">
              Look for tickets again
            </Link>
          </Outcome>
        </Shell>
      );
    case "failed":
      return (
        <Shell>
          <Outcome headingRef={heading} tone="bad" title="Payment didn’t go through" reason={state.order.statusReason}>
            <Link href={routes.checkoutStep(state.order.holdId, "payment")} className="underline underline-offset-4">
              Try another card
            </Link>{" "}
            — your tickets are still held for now.
          </Outcome>
        </Shell>
      );
  }
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">{children}</div>;
}

function Outcome({
  headingRef,
  tone,
  title,
  reason,
  children,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  tone: "warn" | "bad";
  title: string;
  reason: string | null;
  children: ReactNode;
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
function TicketStub({
  event,
  attendee,
  tier,
  seat,
  code,
}: {
  event: string;
  attendee: string;
  tier: string;
  /** "Stalls, row F, seat 12", for reserved seating. */
  seat: string | null;
  code: string;
}) {
  return (
    <article aria-label={`Ticket for ${attendee}`} className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="p-5">
        <p className="tabular text-[11px] tracking-[0.16em] text-ink-3 uppercase">Admit one</p>
        <p className="mt-1 font-display text-lg font-semibold">{event}</p>
        {seat && <p className="mt-2 font-medium">{seat}</p>}
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
