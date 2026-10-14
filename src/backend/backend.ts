/**
 * The simulated backend's application layer: one object per sandbox that owns the
 * state, composes the domain modules, keeps the idempotency store, and notifies
 * subscribers (persistence, the webhook runtime, the chaos panel) after every command.
 *
 * Domain rules live in `domain/*`; this file only orchestrates. Operations return a
 * Result carrying an HTTP status, which the MSW handlers turn into a Response.
 */
import { catalog, getEventInfo } from "@/core/catalog";
import type { HoldResponse, OrderView, PaymentView } from "@/contract/dto";
import { cardSchema } from "@/core/schemas";
import { getPreset, type PresetId } from "@/backend/chaos/presets";
import type { BackendContext, Deps } from "./domain/context";
import { availableQuantity, createHold, crowdTick, findHold } from "./domain/inventory";
import { findOrder, upsertOrder } from "./domain/orders";
import { confirmChallenge, createPayment, type PaymentAttempt } from "./domain/payments";
import { fail, ok, type Result, type ServiceError } from "./domain/result";
import { initialState, type LogKind, type ServerState } from "./domain/state";
import { toEventView, toHoldResponse, toOrderView, toPaymentView } from "./domain/views";
import { deliverDue, nextDeliveryAt } from "./domain/webhooks";

const LOG_LIMIT = 120;

export type PaymentResult = { payment: PaymentView; order: OrderView };

/** Why a payment failed, in words for the buyer — keyed by the payment's failure code. */
const PAYMENT_FAILURES: Record<string, string> = {
  card_declined: "Your card was declined. Try a different card.",
  authentication_failed: "Authentication failed. Try again or use a different card.",
};

const map = <T, U>(result: Result<T>, transform: (value: T) => U): Result<U> =>
  result.ok ? ok(transform(result.value), result.status) : result;

export function createBackend(deps: Deps, initial: ServerState = initialState()) {
  const listeners = new Set<() => void>();
  // State is mutated in place, so subscribers (React's useSyncExternalStore) need a
  // value that changes on every update to know something happened.
  let version = 0;

  const context: BackendContext = {
    state: initial,
    deps,
    chaos: () => getPreset(context.state.presetId).config,
    log(kind: LogKind, message: string) {
      const { state } = context;
      state.logSeq += 1;
      state.log.push({ id: state.logSeq, at: deps.now(), kind, message });
      if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
    },
  };

  const notify = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  /** Run a command, then tell subscribers the state may have changed. */
  const command = <T>(run: () => T): T => {
    const result = run();
    notify();
    return result;
  };

  /** An attempted charge becomes a 202, or a 402 when the bank said no. */
  const toPaymentResult = ({ payment, order }: PaymentAttempt, status: number): Result<PaymentResult> => {
    if (payment.status === "failed") {
      const code = payment.failureCode ?? "card_declined";
      return fail(402, code, PAYMENT_FAILURES[code] ?? "The payment didn’t go through.", {
        payment: toPaymentView(payment),
      });
    }
    return ok({ payment: toPaymentView(payment), order: toOrderView(context, order) }, status);
  };

  return {
    getState: () => context.state,
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chaos: () => context.chaos(),
    setPreset: (id: PresetId) =>
      command(() => {
        context.state.presetId = id;
        context.log("request", `Chaos preset: ${getPreset(id).label}.`);
      }),
    /** Start a fresh sandbox, keeping the chosen preset. */
    reset: () =>
      command(() => {
        context.state = initialState(context.state.presetId);
        context.log("request", "Sandbox reset.");
      }),
    log: (kind: LogKind, message: string) => command(() => context.log(kind, message)),

    listEvents: () => ok(catalog.map((event) => toEventView(context, event))),
    getEvent(slug: string) {
      const event = getEventInfo(slug);
      return event ? ok(toEventView(context, event)) : fail(404, "not_found", "No such event.");
    },

    createHold: (body: unknown): Result<HoldResponse> =>
      command(() => map(createHold(context, body), (hold) => toHoldResponse(context, hold))),
    getHold: (holdId: string): Result<HoldResponse> =>
      map(findHold(context, holdId), (hold) => toHoldResponse(context, hold)),

    upsertOrder: (body: unknown): Result<OrderView> =>
      command(() => map(upsertOrder(context, body), (order) => toOrderView(context, order))),
    getOrder: (orderId: string): Result<OrderView> =>
      map(findOrder(context, orderId), (order) => toOrderView(context, order)),

    /**
     * Start a payment. The Idempotency-Key makes retries safe: the same key always
     * gets the same response, so a double-click or a retried request can never charge
     * twice. Only attempted charges are stored — a request rejected before charging
     * (an expired hold, an invalid card) can be retried with the same key once fixed.
     */
    createPayment: (orderId: string, body: unknown, idempotencyKey: string | null): Result<PaymentResult> =>
      command(() => {
        if (!idempotencyKey) {
          return fail(400, "missing_idempotency_key", "Payments need an Idempotency-Key header.");
        }
        const card = cardSchema.safeParse(body);
        const fingerprint = `${orderId}:${card.success ? card.data.number.slice(-4) : "invalid"}`;
        const replay = context.state.idempotency[idempotencyKey];
        if (replay) {
          if (replay.fingerprint !== fingerprint) {
            return fail(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
          }
          context.log("payment", `Idempotency-Key replayed — returning the original response, no new charge.`);
          return replay.status < 400
            ? ok(replay.body as PaymentResult, replay.status)
            : { ok: false, error: replay.body as ServiceError };
        }

        const attempt = createPayment(context, orderId, body);
        if (!attempt.ok) return attempt;
        const result = toPaymentResult(attempt.value, attempt.status);
        context.state.idempotency[idempotencyKey] = {
          fingerprint,
          status: result.ok ? result.status : result.error.status,
          body: result.ok ? result.value : result.error,
        };
        return result;
      }),

    /** The buyer's answer to the bank's authentication challenge. */
    confirmChallenge: (paymentId: string, isApproved: boolean): Result<PaymentResult> =>
      command(() => {
        const attempt = confirmChallenge(context, paymentId, isApproved);
        return attempt.ok ? toPaymentResult(attempt.value, attempt.status) : attempt;
      }),

    /** When the next webhook is due, so the runtime can sleep until then. */
    nextDeliveryAt: () => nextDeliveryAt(context),
    /** Deliver every webhook that's due. Returns how many were delivered. */
    deliverDue() {
      const delivered = deliverDue(context);
      if (delivered) notify();
      return delivered;
    },
    /** Background buying, so availability visibly moves while the crowd preset is on. */
    crowdTick() {
      const hasBought = crowdTick(context);
      if (hasBought) notify();
      return hasBought;
    },

    available: (tierId: string) => availableQuantity(context, tierId),
  };
}

export type Backend = ReturnType<typeof createBackend>;
