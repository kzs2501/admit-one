"use client";

import { useEffect, useRef } from "react";
import type { OrderDto } from "@/contract/dto";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/form-actions";
import { Notice } from "@/components/ui/notice";
import { checkoutOutcome } from "@/features/checkout/domain/payment-methods";
import { useRazorpayPayment } from "@/features/checkout/hooks/use-razorpay-payment";

/** What Razorpay's test mode takes, from its list of test cards: no real money moves. */
export const RAZORPAY_TEST_DETAILS = [
  // An Indian card: Razorpay treats 4111 1111 1111 1111 as international, which a test
  // account may not take.
  {
    label: "Card",
    value: "4100 2800 0000 1007",
    isTyped: true,
    note: "an Indian Visa: any future expiry, any CVV, then any 4–10 digit OTP",
  },
  {
    label: "Net banking",
    value: "Any bank",
    isTyped: false,
    note: "then Success, or Failure, on the test bank’s page",
  },
] as const;

/**
 * Pay through Razorpay's checkout: one button, which opens Razorpay's page over this one.
 * There the buyer picks how to pay, from what the Razorpay account offers (a card, their
 * bank, a wallet, UPI), and Razorpay takes the details; this app only ever sees whether
 * the payment was made.
 */
export function RazorpayPayment({
  holdId,
  order,
  goBack,
  onExpired,
}: {
  holdId: string;
  order: OrderDto;
  goBack: (() => void) | null;
  onExpired: () => void;
}) {
  const razorpay = useRazorpayPayment({ holdId, order, onExpired });
  const total = formatMoney(order.amounts.totalMinor, order.amounts.currency);
  const outcome = checkoutOutcome(order);

  // A checkout that ended without paying is said where focus is, so it's announced and in view.
  const outcomeNotice = useRef<HTMLDivElement>(null);
  const outcomeTitle = outcome?.title ?? null;
  const shownOutcome = useRef(outcomeTitle);
  useEffect(() => {
    if (outcomeTitle && outcomeTitle !== shownOutcome.current) outcomeNotice.current?.focus();
    shownOutcome.current = outcomeTitle;
  }, [outcomeTitle]);

  const isBusy = razorpay.isStarting || razorpay.isConfirming;
  const label = razorpay.isConfirming
    ? "Confirming…"
    : razorpay.isStarting
      ? "Opening Razorpay…"
      : razorpay.pending
        ? "Return to Razorpay’s checkout"
        : `Pay ${total} with Razorpay`;

  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-5">
      <p className="text-sm text-ink-2">
        You’ll pay {total} on Razorpay’s secure checkout, by card, net banking or a wallet. Your card details go to
        Razorpay, never to admit-one.
      </p>
      {outcome && (
        <div ref={outcomeNotice} tabIndex={-1} className="outline-none">
          <Notice tone={outcome.tone} title={outcome.title} role={outcome.tone === "bad" ? "alert" : "status"}>
            {outcome.message} Your tickets are still held.
          </Notice>
        </div>
      )}
      {razorpay.problem === "blocked" && (
        <Notice tone="bad" title="Razorpay’s checkout didn’t load" role="alert">
          Check your connection, or allow checkout.razorpay.com if something on this browser blocks it, then try again.
        </Notice>
      )}
      {razorpay.problem === "unconfirmed" && (
        <Notice tone="warn" title="Confirming your payment" role="status">
          Razorpay is telling us about your payment. This page moves on by itself once it has.
        </Notice>
      )}
      {razorpay.hasConnectionProblem && (
        <Notice tone="warn" title="Connection problem" role="alert">
          Nothing was opened twice — press Pay again to retry safely.
        </Notice>
      )}
      {razorpay.requestProblem && (
        <Notice tone="bad" title="The checkout didn’t open" role="alert">
          {razorpay.requestProblem}
        </Notice>
      )}

      <section aria-labelledby="razorpay-test-mode" className="rounded-lg border border-dashed border-line bg-sunk p-3">
        <h2 id="razorpay-test-mode" className="text-sm font-medium">
          Razorpay’s test mode
        </h2>
        <p className="mt-1 text-sm text-ink-2">No real money moves. Pay with:</p>
        <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          {RAZORPAY_TEST_DETAILS.map(({ label: name, value, isTyped, note }) => (
            <div key={name} className="contents">
              <dt className="text-ink-2">{name}</dt>
              <dd>
                <span className={isTyped ? "font-mono select-all" : undefined}>{value}</span>{" "}
                <span className="text-ink-3">({note})</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <FormActions onBack={razorpay.pending ? null : goBack} isBackDisabled={isBusy}>
          <Button type="button" onClick={razorpay.pay} isBusy={isBusy}>
            {label}
          </Button>
        </FormActions>
        {razorpay.pending && (
          <Button type="button" variant="secondary" onClick={razorpay.cancel} isBusy={razorpay.isCancelling}>
            Cancel and start again
          </Button>
        )}
      </div>
    </div>
  );
}
