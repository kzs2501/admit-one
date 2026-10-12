"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { cardSchema, type CardInput } from "@/shared/schemas";
import { formatMoney } from "@/shared/money";
import { api, ApiError, type PaymentResponse } from "@/lib/api";
import { Button, Notice } from "@/components/ui";
import type { StepProps } from "./types";
import { attemptFor, type Attempt } from "@/checkout/attempt";

const TEST_CARDS = [
  { label: "Succeeds", number: "4242 4242 4242 4242" },
  { label: "Declined", number: "4000 0000 0000 0002" },
  { label: "Needs 3-D Secure", number: "4000 0025 0000 3155" },
];

const newKey = () => crypto.randomUUID();

/**
 * Pay for the order. The response to "pay" is never treated as proof of payment:
 * on success we go to the order page, which waits for the provider's webhook.
 */
export function PaymentStep({ ctx, goBack, onExpired }: StepProps) {
  const router = useRouter();
  const order = ctx.order!;
  const orderPage = `/orders/${order.id}`;

  // The current payment attempt and its idempotency key (see attempt.ts). A
  // definitive answer (declined, authentication failed) ends the attempt.
  const attempt = useRef<Attempt | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const challenge = useRef<HTMLDialogElement>(null);
  // A refresh in the middle of 3-D Secure brings the challenge straight back.
  const [challengePaymentId, setChallengePaymentId] = useState<string | null>(() =>
    order.payment?.status === "requires_action" ? order.payment.id : null,
  );
  const [declined, setDeclined] = useState<string | null>(null);

  const form = useForm<CardInput>({
    resolver: zodResolver(cardSchema),
    defaultValues: { number: "", expiry: "", cvc: "", name: ctx.draft.attendees[0]?.name ?? "" },
    mode: "onTouched",
  });

  const failedDefinitively = (message: string) => {
    attempt.current = null;
    setDeclined(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  const handleResponse = (res: PaymentResponse) => {
    if (res.payment.status === "requires_action") {
      setChallengePaymentId(res.payment.id);
      return;
    }
    router.push(orderPage);
  };

  const pay = useMutation({
    mutationFn: (card: CardInput) => {
      attempt.current = attemptFor(attempt.current, card.number, newKey);
      return api.createPayment(order.id, card, attempt.current.key);
    },
    onSuccess: handleResponse,
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 402) failedDefinitively(error.message);
      else if (error.status === 410) onExpired();
      else if (error.code === "payment_in_progress" || error.code === "already_completed") router.push(orderPage);
      else if (error.code === "invalid_card") form.setError("number", { message: error.message });
    },
  });

  const authenticate = useMutation({
    mutationFn: (approve: boolean) => api.confirmChallenge(challengePaymentId!, approve),
    onSuccess: (res) => {
      setChallengePaymentId(null);
      handleResponse(res);
    },
    onError: (error) => {
      setChallengePaymentId(null);
      if (error instanceof ApiError && error.status === 402) failedDefinitively(error.message);
    },
  });

  useEffect(() => {
    const dialog = challenge.current;
    if (!dialog) return;
    if (challengePaymentId && !dialog.open) dialog.showModal();
    if (!challengePaymentId && dialog.open) dialog.close();
  }, [challengePaymentId]);

  const err = form.formState.errors;
  const field = (name: keyof CardInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`card-${name}`} className="block text-sm text-ink-2">
        {label}
      </label>
      <input
        id={`card-${name}`}
        aria-invalid={err[name] ? true : undefined}
        aria-describedby={err[name] ? `card-${name}-error` : undefined}
        {...props}
        {...form.register(name)}
        className="tabular mt-1.5 h-11 w-full rounded-lg border border-line bg-paper px-3 text-base aria-[invalid=true]:border-bad"
      />
      {err[name] && (
        <p id={`card-${name}-error`} className="mt-1.5 text-sm text-bad">
          {err[name]?.message}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dashed border-line bg-sunk p-4">
        <p className="text-sm font-medium">Test cards</p>
        <p className="mt-0.5 text-sm text-ink-2">No real payments here. Pick a card to fill the form:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEST_CARDS.map((c) => (
            <button
              key={c.number}
              type="button"
              onClick={() => {
                form.setValue("number", c.number, { shouldValidate: true });
                form.setValue("expiry", "12 / 30", { shouldValidate: true });
                form.setValue("cvc", "123", { shouldValidate: true });
              }}
              className="press rounded-md border border-line bg-card px-3 py-2 text-sm hover:bg-paper"
            >
              {c.label} <span className="tabular ml-1 text-ink-3">…{c.number.slice(-4)}</span>
            </button>
          ))}
        </div>
      </div>

      <form
        noValidate
        onSubmit={form.handleSubmit((card) => {
          setDeclined(null);
          pay.mutate(card);
        })}
        className="space-y-4 rounded-xl border border-line bg-card p-5"
      >
        {field("name", "Name on card", { autoComplete: "cc-name" })}
        {field("number", "Card number", { autoComplete: "cc-number", inputMode: "numeric", placeholder: "4242 4242 4242 4242" })}
        <div className="grid grid-cols-2 gap-4">
          {field("expiry", "Expiry", { autoComplete: "cc-exp", inputMode: "numeric", placeholder: "MM / YY" })}
          {field("cvc", "Security code", { autoComplete: "cc-csc", inputMode: "numeric", placeholder: "123" })}
        </div>

        {declined && (
          <div ref={errorRef} tabIndex={-1} className="outline-none">
            <Notice tone="bad" title="Payment didn’t go through" role="alert">
              {declined} Your tickets are still held.
            </Notice>
          </div>
        )}
        {pay.isError && !(pay.error instanceof ApiError && pay.error.status < 500) && (
          // A dropped connection (fetch throws) or a server error: the outcome is
          // unknown, so the same attempt key is kept and a retry is safe.
          <Notice tone="warn" title="Connection problem" role="alert">
            Nothing was charged twice — press Pay again to retry safely.
          </Notice>
        )}

        <div className="flex justify-between gap-3 pt-1">
          {goBack ? (
            <Button type="button" variant="ghost" onClick={goBack} disabled={pay.isPending}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" busy={pay.isPending}>
            {pay.isPending ? "Processing…" : `Pay ${formatMoney(order.amounts.totalCents)}`}
          </Button>
        </div>
      </form>

      <dialog
        ref={challenge}
        aria-labelledby="challenge-title"
        onCancel={(e) => e.preventDefault()} // the bank decides, not Escape
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-card p-6 text-ink shadow-2xl backdrop:bg-ink/40"
      >
        <h2 id="challenge-title" className="font-display text-lg font-semibold">
          Confirm it’s you
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Your bank wants to check this {formatMoney(order.amounts.totalCents)} payment. (Simulated 3-D Secure —
          choose an outcome.)
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => authenticate.mutate(false)} disabled={authenticate.isPending}>
            Fail authentication
          </Button>
          <Button onClick={() => authenticate.mutate(true)} busy={authenticate.isPending} autoFocus>
            Approve
          </Button>
        </div>
      </dialog>
    </div>
  );
}
