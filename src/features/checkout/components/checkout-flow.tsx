"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, problemOf } from "@/lib/api-client";
import { useMounted } from "@/lib/use-mounted";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { clockOffset } from "@/features/checkout/domain/countdown";
import { useDraft } from "@/features/checkout/hooks/use-draft";
import { ExpiredPanel } from "./expired-panel";
import { HoldTimer } from "./hold-timer";
import {
  applicableSteps,
  nextStep,
  previousStep,
  resolveStep,
  stepHref,
  type StepId,
  type StepContext,
} from "@/features/checkout/domain/step-registry";
import { OrderSummary } from "./order-summary";
import { AddOnsStep } from "@/features/checkout/components/steps/add-ons-step";
import { AttendeesStep } from "@/features/checkout/components/steps/attendees-step";
import { PaymentStep } from "@/features/checkout/components/steps/payment-step";
import { ReviewStep } from "@/features/checkout/components/steps/review-step";
import type { StepProps } from "@/features/checkout/components/steps/step-props";

const components: Record<StepId, ComponentType<StepProps>> = {
  attendees: AttendeesStep,
  "add-ons": AddOnsStep,
  review: ReviewStep,
  payment: PaymentStep,
};

/**
 * The checkout shell. The URL decides which step you're on; the registry decides
 * whether you're allowed to be there. Everything else — progress, guards, the
 * countdown, expiry — is handled here once, for every step.
 */
export function CheckoutFlow({ holdId }: { holdId: string }) {
  const router = useRouter();
  const step = useParams<{ step: string }>().step ?? "";
  const mounted = useMounted();
  const [draft, updateDraft] = useDraft(holdId);
  const [expiredLocally, setExpiredLocally] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<string | null>(null);

  const query = useQuery({ queryKey: ["hold", holdId], queryFn: () => apiClient.getHold(holdId) });
  const data = query.data;
  const offset = data ? clockOffset(Date.parse(data.serverTime), query.dataUpdatedAt) : 0;

  const ctx: StepContext | null =
    data && mounted ? { event: data.event, hold: data.hold, draft, order: data.order } : null;
  const paymentInFlight = data?.order?.payment?.status === "processing";
  const settled =
    data && (data.hold.status === "converted" || ["paid", "fulfilled", "refunded"].includes(data.order?.status ?? ""));
  const expired = data && !paymentInFlight && !settled && (expiredLocally || data.hold.status === "expired");
  const resolved = ctx ? resolveStep(step, ctx) : null;

  // Leave the checkout once there's an order outcome (or a payment the webhook will settle).
  useEffect(() => {
    if (data?.order && (settled || paymentInFlight)) router.replace(`/orders/${data.order.id}`);
  }, [data, settled, paymentInFlight, router]);

  // Keep the URL honest: if this step isn't allowed yet, go to the one that is.
  useEffect(() => {
    if (resolved?.redirect && !expired && !settled && !paymentInFlight)
      router.replace(stepHref(holdId, resolved.step.id));
  }, [resolved, expired, settled, paymentInFlight, holdId, router]);

  // Move focus to the new step's heading, so keyboard and screen-reader users land
  // at the start of what changed instead of on a button that no longer exists.
  const currentId = resolved && !resolved.redirect ? resolved.step.id : null;
  useEffect(() => {
    if (!currentId) return;
    if (shownStep.current && shownStep.current !== currentId) heading.current?.focus();
    shownStep.current = currentId;
  }, [currentId]);

  const onExpire = useCallback(() => {
    setExpiredLocally(true);
    query.refetch();
  }, [query]);

  if (query.isError) {
    const isMissing = problemOf(query.error)?.code === "not_found";
    return (
      <div className="mx-auto max-w-lg px-5 py-16 sm:px-8">
        <Notice
          tone="bad"
          title={isMissing ? "We can’t find that reservation" : "Couldn’t load your checkout"}
          role="alert"
        >
          {isMissing
            ? "It may belong to another browser tab, or the sandbox was reset."
            : "Check your connection and try again."}{" "}
          <Link href="/" className="underline underline-offset-4">
            Browse events
          </Link>
        </Notice>
      </div>
    );
  }

  if (data && expired && ctx)
    return <ExpiredPanel hold={data.hold} event={data.event} step={currentId ?? "attendees"} />;

  if (!ctx || !resolved || resolved.redirect || settled || paymentInFlight) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner label="Loading your checkout" className="size-6 text-ink-3" />
      </div>
    );
  }

  const flow = applicableSteps(ctx);
  const index = flow.findIndex((s) => s.id === resolved.step.id);
  const Step = components[resolved.step.id];
  const back = previousStep(resolved.step.id, ctx);
  const next = nextStep(resolved.step.id, ctx);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Checkout progress">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {flow.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-ink-3">
                    ›
                  </span>
                )}
                {i < index ? (
                  <Link
                    href={stepHref(holdId, s.id)}
                    className="text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                  >
                    {s.label}
                  </Link>
                ) : (
                  <span
                    aria-current={i === index ? "step" : undefined}
                    className={i === index ? "font-medium" : "text-ink-3"}
                  >
                    {s.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <HoldTimer expiresAtMs={Date.parse(ctx.hold.expiresAt)} offset={offset} onExpire={onExpire} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="step-title">
          <p className="tabular text-xs tracking-[0.14em] text-ink-3 uppercase">
            Step {index + 1} of {flow.length}
          </p>
          <h1
            ref={heading}
            id="step-title"
            tabIndex={-1}
            className="mt-1 mb-6 font-display text-3xl font-semibold tracking-tight outline-none"
          >
            {resolved.step.title}
          </h1>
          <Step
            ctx={ctx}
            holdId={holdId}
            draft={draft}
            updateDraft={updateDraft}
            goNext={() => next && router.push(stepHref(holdId, next.id))}
            goBack={back ? () => router.push(stepHref(holdId, back.id)) : null}
            onExpired={onExpire}
          />
        </section>
        <div className="lg:sticky lg:top-8 lg:self-start">
          <OrderSummary event={ctx.event} items={ctx.hold.items} addOns={draft.addOns} />
        </div>
      </div>
    </div>
  );
}
