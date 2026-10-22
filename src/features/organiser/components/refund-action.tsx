"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { OrganiserOrderDto } from "@/contract/dto";
import { REFUND_REASONS, type RefundReason } from "@/core/statuses";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useRefund } from "@/features/organiser/hooks/use-refund";

const REASON_LABELS: Record<RefundReason, string> = {
  requested_by_customer: "The buyer asked for it",
  event_changed: "The event changed",
  duplicate: "It’s a duplicate order",
  other: "Another reason",
};

/**
 * Refund this order in full, after confirming in a native dialog (which traps focus,
 * closes on Escape and gives focus back to the button that opened it). Only shown to
 * accounts that may refund, for orders that can be.
 */
export function RefundAction({ order }: { order: OrganiserOrderDto }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  const started = useRef<HTMLParagraphElement>(null);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const titleId = useId();
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");
  const [failedWith, setFailedWith] = useState<string | null>(null);
  const refund = useRefund(order, {
    onFailed: (message) => {
      setFailedWith(message);
    },
  });

  useEffect(() => {
    if (failedWith) failure.current?.focus();
  }, [failedWith]);

  // The button that opened the dialog is gone once the refund is pending, so the dialog
  // can't hand focus back to it: take focus to what replaced it instead.
  const isPending = order.refundStatus === "pending";
  useEffect(() => {
    if (hasConfirmed && isPending) started.current?.focus();
  }, [hasConfirmed, isPending]);

  const total = formatMoney(order.totalMinor, order.currency);
  const canRefund = order.status === "fulfilled" && order.refundStatus === null;

  return (
    <div className="flex flex-col items-end gap-3">
      {canRefund && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setFailedWith(null);
            dialog.current?.showModal();
          }}
        >
          Refund…
        </Button>
      )}
      {isPending && (
        <p ref={started} tabIndex={-1} role="status" className="text-sm text-ink-2 outline-none">
          Refund started. The order is refunded once the payment provider confirms.
        </p>
      )}
      {failedWith && (
        <div ref={failure} tabIndex={-1} className="max-w-md outline-none">
          <Notice tone="bad" title="The refund didn’t go through" role="alert">
            {failedWith} The order hasn’t changed.
          </Notice>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-card p-6 text-ink shadow-2xl backdrop:bg-ink/40"
      >
        <form
          method="dialog"
          onSubmit={() => {
            setHasConfirmed(true);
            refund.mutate(reason);
          }}
        >
          <h2 id={titleId} className="font-display text-lg font-semibold">
            Refund {total} to {order.buyerName}?
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            The whole order is refunded to the {order.paymentMethod === "upi" ? "UPI account" : "card"} it was paid
            with, and its tickets go back on sale. Door scanners refuse the old tickets once they’ve checked for
            refunds, which they do every minute while online. This can’t be undone.
          </p>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Why?</legend>
            <div className="mt-2 space-y-2">
              {REFUND_REASONS.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="refund-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => {
                      setReason(value);
                    }}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {REASON_LABELS[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
              Keep the order
            </Button>
            <Button type="submit">Refund {total}</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
