"use client";

import { formatMoney } from "@/lib/format";
import { formatRemaining, remainingMs, useNow } from "@/lib/clock";
import { SIMULATED_PHONE_ID } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { useSandboxControl } from "@/features/sandbox/hooks/use-sandbox-control";

/**
 * The buyer's phone, simulated: when a UPI request is waiting, it shows what their UPI
 * app would — who's asking, for how much — and lets them approve or decline. It talks
 * to the sandbox directly, not to the shop's API, because that's where the real answer
 * happens too: between the buyer, their app and their bank. The shop hears about it
 * from the payment provider's webhook.
 *
 * It sits in the page's flow, below the checkout, so it never covers anything.
 */
export function SimulatedPhone() {
  const sandbox = useSandboxControl();
  const request = sandbox?.getPendingUpiRequest() ?? null;
  // Ticks while a request shows, which also re-reads it: an expired one disappears.
  const now = useNow(request !== null);
  if (!sandbox || !request) return null;

  return (
    <section
      id={SIMULATED_PHONE_ID}
      aria-labelledby="phone-title"
      className="mx-auto w-full max-w-5xl px-5 pb-10 sm:px-8"
    >
      <div className="mx-auto max-w-xs rounded-[2rem] border-4 border-ink/80 bg-card px-5 pt-4 pb-6 shadow-xl">
        <div aria-hidden="true" className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-line" />
        <h2 id="phone-title" className="tabular text-[11px] tracking-[0.14em] text-ink-3 uppercase">
          Your phone · simulated
        </h2>
        <p className="mt-3 text-sm text-ink-2">UPI payment request from {request.payeeName}</p>
        <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
          {formatMoney(request.amountMinor, "INR")}
        </p>
        <p className="mt-1 text-xs text-ink-3">
          Expires in <span className="tabular">{formatRemaining(remainingMs(request.expiresAtMs, now))}</span>. A real
          UPI app would ask for your UPI PIN.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              sandbox.respondInUpiApp(request.paymentId, "decline");
            }}
          >
            Decline
          </Button>
          <Button
            type="button"
            onClick={() => {
              sandbox.respondInUpiApp(request.paymentId, "approve");
            }}
          >
            Approve
          </Button>
        </div>
      </div>
    </section>
  );
}
