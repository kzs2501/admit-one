"use client";

import { useEffect, useRef } from "react";
import type { OrderDto } from "@/contract/dto";
import { formatMoney } from "@/lib/format";
import { formatRemaining, remainingMs, useNow } from "@/lib/clock";
import { SIMULATED_PHONE_ID } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/form-actions";
import { Notice } from "@/components/ui/notice";
import { upiOutcome, type PendingUpiRequest } from "@/features/checkout/domain/payment-methods";
import { useUpiPayment } from "@/features/checkout/hooks/use-upi-payment";
import { UpiQrCode } from "./upi-qr-code";

/**
 * Pay by UPI: ask for a payment request, then approve it in a UPI app — by scanning a
 * QR code on a computer, or by opening the app on a phone. While the request waits,
 * it's the only way forward; cancelling it brings the choice of method back.
 */
export function UpiPayment({
  holdId,
  order,
  goBack,
  onExpired,
  clockOffsetMs,
}: {
  holdId: string;
  order: OrderDto;
  goBack: (() => void) | null;
  onExpired: () => void;
  clockOffsetMs: number;
}) {
  const upi = useUpiPayment({ holdId, order, onExpired });
  const total = formatMoney(order.amounts.totalMinor, order.amounts.currency);
  const outcome = upiOutcome(order);
  const outcomeNotice = useRef<HTMLDivElement>(null);

  // A request that ended without paying is said where focus is, so it's announced and in view.
  const outcomeTitle = outcome?.title ?? null;
  useEffect(() => {
    if (outcomeTitle) outcomeNotice.current?.focus();
  }, [outcomeTitle]);

  if (upi.pending) {
    return (
      <PendingRequest
        request={upi.pending}
        total={total}
        clockOffsetMs={clockOffsetMs}
        onCancel={upi.cancel}
        isCancelling={upi.isCancelling}
      />
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-5">
      <p className="text-sm text-ink-2">
        You’ll approve {total} in your UPI app: scan a QR code, or open the app on this phone. Nothing is taken until
        you approve.
      </p>
      {outcome && (
        <div ref={outcomeNotice} tabIndex={-1} className="outline-none">
          <Notice tone={outcome.tone} title={outcome.title} role={outcome.tone === "bad" ? "alert" : "status"}>
            {outcome.message} Your tickets are still held.
          </Notice>
        </div>
      )}
      {upi.hasConnectionProblem && (
        <Notice tone="warn" title="Connection problem" role="alert">
          Nothing was requested twice — press Pay again to retry safely.
        </Notice>
      )}
      <div className="pt-1">
        <FormActions onBack={goBack} isBackDisabled={upi.isRequesting}>
          <Button type="button" onClick={upi.request} isBusy={upi.isRequesting}>
            {upi.isRequesting ? "Requesting…" : `Pay ${total} with UPI`}
          </Button>
        </FormActions>
      </div>
    </div>
  );
}

function PendingRequest({
  request,
  total,
  clockOffsetMs,
  onCancel,
  isCancelling,
}: {
  request: PendingUpiRequest;
  total: string;
  clockOffsetMs: number;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const now = useNow(true);
  const left = remainingMs(Date.parse(request.expiresAt), now, clockOffsetMs);
  // The button that asked for the request is gone: take focus to what replaced it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section aria-labelledby="upi-pending-title" className="space-y-5 rounded-xl border border-line bg-card p-5">
      <div>
        <h2
          ref={heading}
          id="upi-pending-title"
          tabIndex={-1}
          className="font-display text-xl font-semibold outline-none"
        >
          Approve {total} in your UPI app
        </h2>
        <p role="status" className="mt-1 text-sm text-ink-2">
          Waiting for your approval…
        </p>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {/* On a computer, scan the code with a phone; on a phone, a code on its own screen can't be scanned. */}
        <UpiQrCode
          value={request.intentUri}
          label={`QR code to pay ${total} to admit-one with UPI`}
          className="hidden size-48 shrink-0 border border-line sm:block"
        />
        <div className="space-y-3 text-sm">
          <p className="hidden sm:block">
            Scan the code with any UPI app on your phone, then approve the payment there.
          </p>
          <a
            href={request.intentUri}
            className="inline-flex min-h-11 press items-center justify-center rounded-lg bg-accent px-5 font-medium text-accent-ink hover:bg-accent-hover sm:hidden"
          >
            Open your UPI app
          </a>
          <p className="text-ink-2">
            The request expires in <span className="tabular font-medium text-ink">{formatRemaining(left)}</span>.
          </p>
        </div>
      </div>

      <p className="rounded-lg border border-dashed border-line bg-sunk p-3 text-sm text-ink-2">
        In this demo no UPI app can pay this request. Approve or decline it on{" "}
        <a href={`#${SIMULATED_PHONE_ID}`} className="underline underline-offset-4 hover:text-ink">
          the simulated phone
        </a>{" "}
        below the checkout.
      </p>

      <Button type="button" variant="secondary" onClick={onCancel} isBusy={isCancelling}>
        Cancel and pay another way
      </Button>
    </section>
  );
}
