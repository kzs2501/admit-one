"use client";

import { useEffect, useRef, type ComponentType, type RefObject } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/ui/error-state";
import { Spinner } from "@/components/ui/spinner";
import { stepHref, type StepId } from "@/features/checkout/domain/step-registry";
import { useCheckout, type CheckoutState } from "@/features/checkout/hooks/use-checkout";
import type { Draft } from "@/features/checkout/hooks/use-draft";
import { AddOnsStep } from "./steps/add-ons-step";
import { AttendeesStep } from "./steps/attendees-step";
import { PaymentStep } from "./steps/payment-step";
import { ReviewStep } from "./steps/review-step";
import type { StepProps } from "./steps/step-props";
import { ExpiredPanel } from "./expired-panel";
import { HoldTimer } from "./hold-timer";
import { OrderSummary } from "./order-summary";

const STEP_COMPONENTS: Record<StepId, ComponentType<StepProps>> = {
  attendees: AttendeesStep,
  "add-ons": AddOnsStep,
  review: ReviewStep,
  payment: PaymentStep,
};

/**
 * The checkout shell. The URL decides which step you're on; the registry decides
 * whether you're allowed to be there (see `useCheckout`). Everything else — progress,
 * the countdown, expiry — is rendered here once, for every step.
 */
export function CheckoutFlow({ holdId }: { holdId: string }) {
  const requestedStep = useParams<{ step?: string }>().step ?? "";
  const { state, updateDraft, expire } = useCheckout(holdId, requestedStep);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStepId = useRef<StepId | null>(null);

  // Move focus to the new step's heading, so keyboard and screen-reader users land at
  // the start of what changed instead of on a button that no longer exists. This lives
  // here, in the part that stays mounted, so it remembers the step across re-renders.
  const readyStepId = state.kind === "ready" ? state.step.id : null;
  useEffect(() => {
    if (!readyStepId) return;
    if (shownStepId.current && shownStepId.current !== readyStepId) heading.current?.focus();
    shownStepId.current = readyStepId;
  }, [readyStepId]);

  switch (state.kind) {
    case "not-found":
      return (
        <ErrorState title="We can’t find that reservation">
          It may belong to another browser tab, or the sandbox was reset.
        </ErrorState>
      );
    case "load-error":
      return <ErrorState title="Couldn’t load your checkout">Check your connection and try again.</ErrorState>;
    case "expired":
      return <ExpiredPanel hold={state.hold} event={state.event} step={state.stepId} />;
    case "loading":
      return (
        <div className="grid min-h-[50vh] place-items-center">
          <Spinner label="Loading your checkout" className="size-6 text-ink-3" />
        </div>
      );
    case "ready":
      return <CheckoutStep state={state} headingRef={heading} updateDraft={updateDraft} onExpire={expire} />;
  }
}

function CheckoutStep({
  state,
  headingRef,
  updateDraft,
  onExpire,
}: {
  state: Extract<CheckoutState, { kind: "ready" }>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  updateDraft: (patch: Partial<Draft>) => void;
  onExpire: () => void;
}) {
  const router = useRouter();
  const { context, step, flow, stepIndex, previous, next } = state;
  const holdId = context.hold.id;

  const Step = STEP_COMPONENTS[step.id];
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Checkout progress">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {flow.map((flowStep, i) => (
              <li key={flowStep.id} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-ink-3">
                    ›
                  </span>
                )}
                {i < stepIndex ? (
                  <Link
                    href={stepHref(holdId, flowStep.id)}
                    className="text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                  >
                    {flowStep.label}
                  </Link>
                ) : (
                  <span
                    aria-current={i === stepIndex ? "step" : undefined}
                    className={i === stepIndex ? "font-medium" : "text-ink-3"}
                  >
                    {flowStep.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <HoldTimer expiresAtMs={state.expiresAtMs} offset={state.clockOffsetMs} onExpire={onExpire} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="step-title">
          <p className="tabular text-xs tracking-[0.14em] text-ink-3 uppercase">
            Step {stepIndex + 1} of {flow.length}
          </p>
          <h1
            ref={headingRef}
            id="step-title"
            tabIndex={-1}
            className="mt-1 mb-6 font-display text-3xl font-semibold tracking-tight outline-none"
          >
            {step.title}
          </h1>
          <Step
            context={context}
            updateDraft={updateDraft}
            goNext={() => {
              if (next) router.push(stepHref(holdId, next.id));
            }}
            goBack={previous ? () => router.push(stepHref(holdId, previous.id)) : null}
            onExpired={onExpire}
            clockOffsetMs={state.clockOffsetMs}
          />
        </section>
        <div className="lg:sticky lg:top-8 lg:self-start">
          <OrderSummary
            event={context.event}
            items={context.hold.items}
            seats={context.hold.seats}
            addOns={context.draft.addOns}
          />
        </div>
      </div>
    </div>
  );
}
