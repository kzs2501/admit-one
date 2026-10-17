/**
 * The simulated backend's application layer: one object per sandbox that owns the
 * state, composes the domain modules, and notifies subscribers (persistence, the
 * webhook runtime, the chaos panel) after every command.
 *
 * Domain rules live in `domain/*`; HTTP concerns — status codes, problem details,
 * idempotency keys, ISO timestamps — live in `http/*`. This file only orchestrates,
 * and returns read models (`domain/views`) or domain errors.
 */
import { CATALOG, findEvent } from "@/core/catalog";
import type { CardDetails } from "@/core/schemas";
import { getPreset, type PresetId } from "@/backend/chaos/presets";
import type { BackendContext, Deps } from "./domain/context";
import { fail, map, ok, type Result } from "./domain/errors";
import {
  availableQuantity,
  createHold,
  findHold,
  findSeatAvailability,
  runCrowdTick,
  type CreateHoldCommand,
} from "./domain/inventory";
import { findOrder, upsertOrder, type UpsertOrderCommand } from "./domain/orders";
import { confirmChallenge, createPayment, type ChallengeDecision, type PaymentAttempt } from "./domain/payments";
import { createInitialState, type IdempotencyRecord, type LogKind, type ServerState } from "./domain/state";
import {
  toEventView,
  toHoldDetailsView,
  toOrderView,
  toPaymentView,
  type EventView,
  type HoldDetailsView,
  type OrderView,
  type PaymentResultView,
  type SeatAvailabilityView,
} from "./domain/views";
import { deliverDue, nextDeliveryAtMs } from "./domain/webhooks";

const LOG_LIMIT = 120;

/** How long an Idempotency-Key is remembered — Stripe's 24 hours. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60_000;

export function createBackend(deps: Deps, initialState: ServerState = createInitialState()) {
  const listeners = new Set<() => void>();
  // State is mutated in place, so subscribers (React's useSyncExternalStore) need a
  // value that changes on every update to know something happened.
  let version = 0;

  const context: BackendContext = {
    state: initialState,
    deps,
    chaos: () => getPreset(context.state.presetId).config,
    log(kind: LogKind, message: string) {
      const { state } = context;
      state.logSequence += 1;
      state.log.push({ id: state.logSequence, atMs: deps.now(), kind, message });
      if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
    },
  };

  const isLive = (record: IdempotencyRecord) => deps.now() - record.createdAtMs < IDEMPOTENCY_KEY_TTL_MS;

  const notify = () => {
    version += 1;
    listeners.forEach((listener) => {
      listener();
    });
  };

  /** Run a command, then tell subscribers the state may have changed. */
  const command = <T>(run: () => T): T => {
    const result = run();
    notify();
    return result;
  };

  const toPaymentResultView = ({ payment, order }: PaymentAttempt): PaymentResultView => ({
    payment: toPaymentView(payment),
    order: toOrderView(context, order),
  });

  return {
    getState: () => context.state,
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chaos: () => context.chaos(),
    setPreset: (id: PresetId) => {
      command(() => {
        context.state.presetId = id;
        context.log("request", `Chaos preset: ${getPreset(id).label}.`);
      });
    },
    /** Start a fresh sandbox, keeping the chosen preset. */
    reset: () => {
      command(() => {
        context.state = createInitialState(context.state.presetId);
        context.log("request", "Sandbox reset.");
      });
    },
    log: (kind: LogKind, message: string) => {
      command(() => {
        context.log(kind, message);
      });
    },

    listEvents: (): EventView[] => CATALOG.map((event) => toEventView(context, event)),
    getEvent(slug: string): Result<EventView> {
      const event = findEvent(slug);
      return event ? ok(toEventView(context, event)) : fail({ code: "not_found", detail: "No such event." });
    },

    /** The seats that are gone, for an event with reserved seating. */
    getSeatAvailability: (eventSlug: string): Result<SeatAvailabilityView> =>
      map(findSeatAvailability(context, eventSlug), (unavailableSeatIds) => ({
        eventSlug,
        unavailableSeatIds,
        serverTimeMs: context.deps.now(),
      })),

    createHold: (input: CreateHoldCommand): Result<HoldDetailsView> =>
      command(() => map(createHold(context, input), (hold) => toHoldDetailsView(context, hold))),
    getHold: (holdId: string): Result<HoldDetailsView> =>
      map(findHold(context, holdId), (hold) => toHoldDetailsView(context, hold)),

    upsertOrder: (input: UpsertOrderCommand): Result<{ order: OrderView; isCreated: boolean }> =>
      command(() =>
        map(upsertOrder(context, input), ({ order, isCreated }) => ({ order: toOrderView(context, order), isCreated })),
      ),
    getOrder: (orderId: string): Result<OrderView> =>
      map(findOrder(context, orderId), (order) => toOrderView(context, order)),

    /** Attempt a charge. Every attempted charge returns its payment, whatever the bank said. */
    createPayment: (orderId: string, card: CardDetails): Result<PaymentResultView> =>
      command(() => map(createPayment(context, orderId, card), toPaymentResultView)),
    /** The buyer's answer to the bank's authentication challenge. */
    confirmChallenge: (paymentId: string, decision: ChallengeDecision): Result<PaymentResultView> =>
      command(() => map(confirmChallenge(context, paymentId, decision), toPaymentResultView)),

    /** The idempotency store: stored HTTP responses, kept with the rest of the sandbox. A key past its TTL is new again. */
    idempotency: {
      find: (key: string): IdempotencyRecord | undefined => {
        const record = context.state.idempotency[key];
        return record && isLive(record) ? record : undefined;
      },
      save: (key: string, record: Omit<IdempotencyRecord, "createdAtMs">) => {
        command(() => {
          // Saving is also when expired keys are dropped, so the store can't grow forever.
          const live = Object.entries(context.state.idempotency).filter(([, stored]) => isLive(stored));
          context.state.idempotency = Object.fromEntries([...live, [key, { ...record, createdAtMs: deps.now() }]]);
        });
      },
    },

    /** When the next webhook is due, so the runtime can sleep until then. */
    nextDeliveryAtMs: () => nextDeliveryAtMs(context),
    /** Deliver every webhook that's due. Returns how many were delivered. */
    deliverDue() {
      const deliveredCount = deliverDue(context);
      if (deliveredCount) notify();
      return deliveredCount;
    },
    /** Background buying, so availability visibly moves while the crowd preset is on. */
    runCrowdTick() {
      const hasBought = runCrowdTick(context);
      if (hasBought) notify();
      return hasBought;
    },

    available: (tierId: string) => availableQuantity(context, tierId),
  };
}

export type Backend = ReturnType<typeof createBackend>;
