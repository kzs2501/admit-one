import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { EventDto, HoldDetailsDto, HoldDto } from "@/contract/dto";
import { isAwaitingConfirmation, isPaidFor } from "@/core/order-status";
import { problemOf } from "@/lib/api-client";
import { holdQueries, shouldShowQueryError } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { clockOffset } from "@/lib/clock";
import { useMounted } from "@/lib/use-mounted";
import {
  applicableSteps,
  nextStep,
  previousStep,
  resolveStep,
  stepHref,
  type Step,
  type StepContext,
  type StepId,
} from "@/features/checkout/domain/step-registry";
import { pendingUpiRequest } from "@/features/checkout/domain/payment-methods";
import { useDraft, type Draft } from "./use-draft";

/** While the buyer approves a UPI request in their app, how often to re-read the order. */
export const UPI_POLL_MS = 2_000;

/**
 * Keep re-reading while a UPI request waits: the buyer answers in another app, and
 * the server hears it from the provider's webhook, so nothing tells this page — it asks.
 */
export const pollWhileApprovingUpi = (details: HoldDetailsDto | undefined) =>
  details?.order && pendingUpiRequest(details.order) ? UPI_POLL_MS : false;

/** Everything the checkout can be showing — exactly one at a time. */
export type CheckoutState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "load-error" }
  | { kind: "expired"; hold: HoldDto; event: EventDto; stepId: StepId }
  | {
      kind: "ready";
      context: StepContext;
      step: Step;
      flow: readonly Step[];
      stepIndex: number;
      previous: Step | null;
      next: Step | null;
      expiresAtMs: number;
      clockOffsetMs: number;
    };

export interface CheckoutInputs {
  requestedStep: string;
  details: HoldDetailsDto | undefined;
  error: unknown;
  /** When the hold was last fetched — the moment its `serverTime` was true. */
  fetchedAtMs: number;
  draft: Draft;
  /** False until the browser's sessionStorage (and so the draft) can be read. */
  isMounted: boolean;
  hasExpiredLocally: boolean;
}

/**
 * Whether the countdown's "expired" still stands: it ran out at `expiredAtMs`, and the
 * server's copy of the hold doesn't say later. A card payment extends a hold, so a
 * guess made from an older copy gives way to the new one.
 */
export function isStillExpiredLocally(expiredAtMs: number | null, holdExpiresAt: string | undefined): boolean {
  return expiredAtMs !== null && holdExpiresAt !== undefined && Date.parse(holdExpiresAt) <= expiredAtMs;
}

/** Where the checkout should be, and where the URL should go — a pure function of its inputs. */
export function deriveCheckout(inputs: CheckoutInputs): {
  state: CheckoutState;
  /** The order page to move to, once money has moved or a payment is with the provider. */
  orderPageId: string | null;
  /** The step the URL should show instead of the requested one. */
  redirectStepId: StepId | null;
} {
  const { details, draft, isMounted } = inputs;
  const order = details?.order ?? null;
  const isOver =
    details !== undefined &&
    (details.hold.status === "converted" || (order !== null && (isPaidFor(order) || isAwaitingConfirmation(order))));
  const isExpired = details !== undefined && !isOver && (inputs.hasExpiredLocally || details.hold.status === "expired");
  const context: StepContext | null =
    details && isMounted ? { event: details.event, hold: details.hold, draft, order } : null;
  const resolution = context ? resolveStep(inputs.requestedStep, context) : null;

  const orderPageId = isOver ? (order?.id ?? null) : null;
  const redirectStepId = resolution?.shouldRedirect && !isOver && !isExpired ? resolution.step.id : null;
  const derive = (state: CheckoutState) => ({ state, orderPageId, redirectStepId });

  if (shouldShowQueryError(details, inputs.error)) {
    return derive({ kind: problemOf(inputs.error)?.code === "not_found" ? "not-found" : "load-error" });
  }
  if (details && context && isExpired) {
    const stepId = resolution && !resolution.shouldRedirect ? resolution.step.id : "attendees";
    return derive({ kind: "expired", hold: details.hold, event: details.event, stepId });
  }
  if (!details || !context || !resolution || resolution.shouldRedirect || isOver) return derive({ kind: "loading" });

  const flow = applicableSteps(context);
  return derive({
    kind: "ready",
    context,
    step: resolution.step,
    flow,
    stepIndex: flow.findIndex((step) => step.id === resolution.step.id),
    previous: previousStep(resolution.step.id, context),
    next: nextStep(resolution.step.id, context),
    expiresAtMs: Date.parse(details.hold.expiresAt),
    clockOffsetMs: clockOffset(Date.parse(details.serverTime), inputs.fetchedAtMs),
  });
}

/**
 * The checkout's view-model. The URL says which step was asked for, the registry says
 * whether it's allowed, and the hold says whether the checkout is still on; this hook
 * combines them into one `CheckoutState` and keeps the URL in step with it.
 */
export function useCheckout(holdId: string, requestedStep: string) {
  const router = useRouter();
  const isMounted = useMounted();
  const [draft, updateDraft] = useDraft(holdId);
  /**
   * The expiry the countdown ran out at. Only a guess until the server agrees: a card
   * payment extends the hold, and the server's copy then says later.
   */
  const [expiredAtMs, setExpiredAtMs] = useState<number | null>(null);
  const {
    data: details,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    ...holdQueries.detail(holdId),
    refetchInterval: (query) => pollWhileApprovingUpi(query.state.data),
  });

  const { state, orderPageId, redirectStepId } = deriveCheckout({
    requestedStep,
    details,
    error,
    fetchedAtMs: dataUpdatedAt,
    draft,
    isMounted,
    hasExpiredLocally: isStillExpiredLocally(expiredAtMs, details?.hold.expiresAt),
  });

  useEffect(() => {
    if (orderPageId) router.replace(routes.order(orderPageId));
  }, [orderPageId, router]);

  useEffect(() => {
    if (redirectStepId) router.replace(stepHref(holdId, redirectStepId));
  }, [redirectStepId, holdId, router]);

  /** The countdown hit zero: say so at once, and re-read the hold, which may have been extended. */
  const expiresAt = details?.hold.expiresAt;
  const expire = useCallback(() => {
    setExpiredAtMs(expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(expiresAt));
    void refetch();
  }, [expiresAt, refetch]);

  return { state, updateDraft, expire };
}
