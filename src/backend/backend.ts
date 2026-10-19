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
import { getPreset, type PresetId } from "@/backend/chaos/presets";
import type { Account } from "@/core/organisations";
import type { OrderFilters, OrderListParams } from "@/contract/queries";
import { authenticate, eventFor, eventsFor, signIn, signOut } from "./domain/access";
import { findOrganiserOrder, listOrders, queryOrders } from "./domain/reporting";
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
import {
  cancelPayment,
  confirmChallenge,
  createPayment,
  findPendingUpiRequest,
  respondInUpiApp,
  type ChallengeDecision,
  type PaymentAttempt,
  type PaymentInput,
  type UpiAppDecision,
} from "./domain/payments";
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
  toAccountView,
  toOrderRowView,
  toOrganiserEventView,
  toOrganiserOrderView,
  type OrderRowView,
  type OrganiserOrderView,
  type AccountView,
  type OrganiserEventView,
  toQueueEntryView,
  toUpiRequestView,
  type QueueEntryView,
  type UpiRequestView,
} from "./domain/views";
import { findQueueEntry, joinQueue } from "./domain/queue";
import { deliverDue, nextDeliveryAtMs } from "./domain/webhooks";

const LOG_LIMIT = 120;

/** How long an Idempotency-Key is remembered — Stripe's 24 hours. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60_000;

export function createBackend(deps: Deps, initialState: ServerState = createInitialState("happy", deps.now())) {
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
    payment: toPaymentView(context, payment),
    order: toOrderView(context, order),
  });

  return {
    getState: () => context.state,
    /** The backend's clock. */
    now: () => deps.now(),
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
        context.state = createInitialState(context.state.presetId, deps.now());
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

    /** Take a place in a sale's waiting room — or get back the one you already have. */
    joinQueue: (eventSlug: string): Result<{ entry: QueueEntryView; isNew: boolean }> =>
      command(() =>
        map(joinQueue(context, eventSlug), ({ entry, isNew }) => ({ entry: toQueueEntryView(context, entry), isNew })),
      ),
    getQueueEntry: (token: string): Result<QueueEntryView> =>
      map(findQueueEntry(context, token), (entry) => toQueueEntryView(context, entry)),

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

    /** Attempt a payment. Every attempted payment returns its payment, whatever the bank said. */
    createPayment: (orderId: string, input: PaymentInput): Result<PaymentResultView> =>
      command(() => map(createPayment(context, orderId, input), toPaymentResultView)),
    /** The buyer's answer to the bank's authentication challenge. */
    confirmChallenge: (paymentId: string, decision: ChallengeDecision): Result<PaymentResultView> =>
      command(() => map(confirmChallenge(context, paymentId, decision), toPaymentResultView)),
    /** Give up on a payment the buyer hasn't approved yet, to pay another way. */
    cancelPayment: (paymentId: string): Result<PaymentResultView> =>
      command(() => map(cancelPayment(context, paymentId), toPaymentResultView)),

    /** The buyer's phone (simulated): the UPI request waiting for them, if any. Not part of the merchant's API. */
    getPendingUpiRequest: (): UpiRequestView | null => {
      const payment = findPendingUpiRequest(context);
      return payment ? toUpiRequestView(payment) : null;
    },
    /** The buyer's answer in their UPI app. The merchant hears it from the webhook. */
    respondInUpiApp: (paymentId: string, decision: UpiAppDecision): Result<PaymentResultView> =>
      command(() => map(respondInUpiApp(context, paymentId, decision), toPaymentResultView)),

    /** Sign in to the organisers' dashboard as a demo account: a bearer token, and who it's for. */
    signIn: (accountId: string): Result<{ token: string; account: AccountView }> =>
      command(() =>
        map(signIn(context, accountId), ({ token, account }) => ({ token, account: toAccountView(account) })),
      ),
    signOut: (token: string) => {
      command(() => {
        signOut(context, token);
      });
    },
    /** The account behind a bearer token, if its session is live. */
    authenticate: (token: string | null): Account | null => authenticate(context, token),
    accountView: (account: Account): AccountView => toAccountView(account),
    listOrganiserEvents: (account: Account): OrganiserEventView[] =>
      eventsFor(account).map((event) => toOrganiserEventView(account, event)),
    getOrganiserEvent: (account: Account, slug: string): Result<OrganiserEventView> =>
      map(eventFor(account, slug), (event) => toOrganiserEventView(account, event)),

    /** A page of the orders this account may see, filtered and sorted on the server. */
    listOrders: (
      account: Account,
      { pageSize, pageToken, ...filters }: OrderListParams,
    ): Result<{ orders: OrderRowView[]; nextPageToken: string | null; totalSize: number }> =>
      map(listOrders(context, account, filters, { pageSize, pageToken }), ({ rows, ...page }) => ({
        ...page,
        orders: rows.map(toOrderRowView),
      })),
    /** Every matching order, for a CSV export. Needs `orders:export`. */
    exportOrders: (account: Account, filters: OrderFilters): Result<OrderRowView[]> =>
      map(queryOrders(context, account, filters, "orders:export"), (rows) => rows.map(toOrderRowView)),
    getOrganiserOrder: (account: Account, orderId: string): Result<OrganiserOrderView> =>
      map(findOrganiserOrder(context, account, orderId), toOrganiserOrderView),

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
