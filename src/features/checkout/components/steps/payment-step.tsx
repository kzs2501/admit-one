"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { OrderDto } from "@/contract/dto";
import { cardSchema, type CardDetails, type CardInput } from "@/core/schemas";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/form-actions";
import { Notice } from "@/components/ui/notice";
import { TextField } from "@/components/ui/text-field";
import { usePayment } from "@/features/checkout/hooks/use-payment";
import type { StepProps } from "./step-props";

/** The simulated provider's test cards, as a payment form's test mode would offer them. */
export const TEST_CARD_OPTIONS = [
  { label: "Succeeds", number: "4242 4242 4242 4242" },
  { label: "Declined", number: "4000 0000 0000 0002" },
  { label: "Needs 3-D Secure", number: "4000 0025 0000 3155" },
] as const;

const TEST_CARD_EXPIRY = "12 / 30";
const TEST_CARD_CVC = "123";

/** Pay for the order. Review creates the order, so it always exists by this step. */
export function PaymentStep({ context, goBack, onExpired }: StepProps) {
  if (!context.order) {
    return (
      <Notice tone="bad" title="There’s no order to pay for yet" role="alert">
        Go back and review your order first.
      </Notice>
    );
  }
  return (
    <PaymentForm
      order={context.order}
      cardholderName={context.draft.attendees[0]?.name ?? ""}
      goBack={goBack}
      onExpired={onExpired}
    />
  );
}

function PaymentForm({
  order,
  cardholderName,
  goBack,
  onExpired,
}: {
  order: OrderDto;
  cardholderName: string;
  goBack: (() => void) | null;
  onExpired: () => void;
}) {
  const declineNotice = useRef<HTMLDivElement>(null);
  const challengeDialog = useRef<HTMLDialogElement>(null);
  const [declineMessage, setDeclineMessage] = useState<string | null>(null);

  const form = useForm<CardInput, unknown, CardDetails>({
    resolver: zodResolver(cardSchema),
    defaultValues: { number: "", expiry: "", cvc: "", name: cardholderName },
    mode: "onTouched",
  });

  const payment = usePayment({
    order,
    onExpired,
    onDeclined: (message) => {
      setDeclineMessage(message);
      // After the notice renders, move focus to it so the outcome is announced and in view.
      requestAnimationFrame(() => declineNotice.current?.focus());
    },
    onInvalidCard: (message) => {
      form.setError("number", { message });
    },
  });

  // Keep the native dialog in step with the challenge: open while the bank is asking.
  useEffect(() => {
    const dialog = challengeDialog.current;
    if (!dialog) return;
    if (payment.challengePaymentId && !dialog.open) dialog.showModal();
    if (!payment.challengePaymentId && dialog.open) dialog.close();
  }, [payment.challengePaymentId]);

  const { errors } = form.formState;
  const total = formatMoney(order.amounts.totalCents);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dashed border-line bg-sunk p-4">
        <p className="text-sm font-medium">Test cards</p>
        <p className="mt-0.5 text-sm text-ink-2">No real payments here. Pick a card to fill the form:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEST_CARD_OPTIONS.map((testCard) => (
            <button
              key={testCard.number}
              type="button"
              onClick={() => {
                form.setValue("number", testCard.number, { shouldValidate: true });
                form.setValue("expiry", TEST_CARD_EXPIRY, { shouldValidate: true });
                form.setValue("cvc", TEST_CARD_CVC, { shouldValidate: true });
              }}
              className="press rounded-md border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
            >
              {testCard.label} <span className="tabular ml-1 text-ink-3">…{testCard.number.slice(-4)}</span>
            </button>
          ))}
        </div>
      </div>

      <form
        noValidate
        onSubmit={form.handleSubmit((card) => {
          setDeclineMessage(null);
          payment.pay(card);
        })}
        className="space-y-4 rounded-xl border border-line bg-card p-5"
      >
        <TextField
          id="card-name"
          label="Name on card"
          error={errors.name?.message}
          inputProps={{ autoComplete: "cc-name", ...form.register("name") }}
        />
        <TextField
          id="card-number"
          label="Card number"
          error={errors.number?.message}
          inputProps={{
            autoComplete: "cc-number",
            inputMode: "numeric",
            placeholder: "4242 4242 4242 4242",
            className: "tabular",
            ...form.register("number"),
          }}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            id="card-expiry"
            label="Expiry"
            error={errors.expiry?.message}
            inputProps={{
              autoComplete: "cc-exp",
              inputMode: "numeric",
              placeholder: "MM / YY",
              className: "tabular",
              ...form.register("expiry"),
            }}
          />
          <TextField
            id="card-cvc"
            label="Security code"
            error={errors.cvc?.message}
            inputProps={{
              autoComplete: "cc-csc",
              inputMode: "numeric",
              placeholder: "123",
              className: "tabular",
              ...form.register("cvc"),
            }}
          />
        </div>

        {declineMessage && (
          <div ref={declineNotice} tabIndex={-1} className="outline-none">
            <Notice tone="bad" title="Payment didn’t go through" role="alert">
              {declineMessage} Your tickets are still held.
            </Notice>
          </div>
        )}
        {payment.hasConnectionProblem && (
          <Notice tone="warn" title="Connection problem" role="alert">
            Nothing was charged twice — press Pay again to retry safely.
          </Notice>
        )}

        <div className="pt-1">
          <FormActions onBack={goBack} isBackDisabled={payment.isPaying}>
            <Button type="submit" busy={payment.isPaying}>
              {payment.isPaying ? "Processing…" : `Pay ${total}`}
            </Button>
          </FormActions>
        </div>
      </form>

      <dialog
        ref={challengeDialog}
        aria-labelledby="challenge-title"
        onCancel={(cancelEvent) => {
          cancelEvent.preventDefault(); // the bank decides, not Escape
        }}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-card p-6 text-ink shadow-2xl backdrop:bg-ink/40"
      >
        <h2 id="challenge-title" className="font-display text-lg font-semibold">
          Confirm it’s you
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Your bank wants to check this {total} payment. (Simulated 3-D Secure — choose an outcome.)
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => payment.authenticate("reject")}
            disabled={payment.isAuthenticating}
          >
            Fail authentication
          </Button>
          <Button onClick={() => payment.authenticate("approve")} busy={payment.isAuthenticating} autoFocus>
            Approve
          </Button>
        </div>
      </dialog>
    </div>
  );
}
