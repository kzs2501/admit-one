"use client";

import { Notice } from "@/components/ui/notice";
import {
  chosenPaymentMethod,
  offeredPaymentMethods,
  pendingRazorpayCheckout,
  pendingUpiRequest,
} from "@/features/checkout/domain/payment-methods";
import { CardPayment } from "@/features/checkout/components/payment-methods/card-payment";
import { RazorpayPayment } from "@/features/checkout/components/payment-methods/razorpay-payment";
import { UpiPayment } from "@/features/checkout/components/payment-methods/upi-payment";
import type { StepProps } from "./step-props";

/**
 * Pay for the order, by whichever method the buyer chooses from those offered for it.
 * Review creates the order, so it always exists by this step.
 */
export function PaymentStep({ context, updateDraft, goBack, onExpired, clockOffsetMs }: StepProps) {
  const { order, draft, hold } = context;
  if (!order) {
    return (
      <Notice tone="bad" title="There’s no order to pay for yet" role="alert">
        Go back and review your order first.
      </Notice>
    );
  }

  const offered = offeredPaymentMethods(order);
  // A UPI request or checkout that's waiting is the only way forward until it's cancelled.
  const pendingMethod = pendingUpiRequest(order) ? "upi" : pendingRazorpayCheckout(order) ? "razorpay" : null;
  const isPending = pendingMethod !== null;
  const method = pendingMethod ?? chosenPaymentMethod(order, draft.paymentMethod);

  return (
    <div className="space-y-5">
      {offered.length > 1 && (
        <fieldset disabled={isPending} className="disabled:opacity-60">
          <legend className="text-sm font-medium">How would you like to pay?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {offered.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  option.id === method ? "border-accent bg-accent-soft" : "border-line bg-card hover:bg-sunk"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={option.id}
                  checked={option.id === method}
                  onChange={() => {
                    updateDraft({ paymentMethod: option.id });
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-sm text-ink-2">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {method === "upi" ? (
        <UpiPayment
          holdId={hold.id}
          order={order}
          goBack={goBack}
          onExpired={onExpired}
          clockOffsetMs={clockOffsetMs}
        />
      ) : method === "razorpay" ? (
        <RazorpayPayment holdId={hold.id} order={order} goBack={goBack} onExpired={onExpired} />
      ) : (
        <CardPayment
          order={order}
          cardholderName={draft.attendees[0]?.name ?? ""}
          goBack={goBack}
          onExpired={onExpired}
        />
      )}
    </div>
  );
}
