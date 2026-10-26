/**
 * The server backend: the buyer's API on Postgres, behind the same port as the
 * sandbox. Stock and seats are the database's business (`stock.ts`); everything else
 * runs the sandbox's own rules on rows loaded for the purpose, so both backends answer
 * alike.
 */
import { CATALOG, findEvent, getEvent, type EventInfo } from "@/core/catalog";
import { fail, map, ok, type Result } from "@/backend/domain/errors";
import type { CreateHoldCommand } from "@/backend/domain/inventory";
import type { BackendContext } from "@/backend/domain/context";
import { findOrder, upsertOrder, type UpsertOrderCommand } from "@/backend/domain/orders";
import {
  cancelPayment,
  checkPayable,
  confirmChallenge,
  createPayment,
  type ChallengeDecision,
  type PaymentAttempt,
  type PaymentInput,
} from "@/backend/domain/payments";
import { isReservedEvent } from "@/backend/domain/seating";
import {
  eventViewOf,
  toHoldDetailsView,
  toOrderView,
  toPaymentView,
  type EventView,
  type HoldDetailsView,
  type OrderView,
  type PaymentResultView,
  type SeatAvailabilityView,
} from "@/backend/domain/views";
import { RazorpayError, type RazorpayClient, type RazorpayPayment } from "@/backend/razorpay/client";
import type { ConfirmRazorpayRequest } from "@/contract/requests";
import type { Database } from "./db";
import type { BuyerPort } from "@/backend/port";
import { createIdempotencyStore } from "./idempotency";
import { settleRazorpayPayment } from "./razorpay";
import { SERVER_SETTINGS, type ServerDeps } from "./records";
import { availability, holdByTiers, holdSeats, unavailableSeatIds } from "./stock";
import { readHold, withHold, type HoldReference } from "./unit-of-work";

const notFound = (detail: string) => fail({ code: "not_found", detail });

const toPaymentResultView = (context: BackendContext, { payment, order }: PaymentAttempt): PaymentResultView => ({
  payment: toPaymentView(context, payment),
  order: toOrderView(context, order),
});

export function createPostgresBackend(
  db: Database,
  deps: ServerDeps,
  { razorpay = null }: { razorpay?: RazorpayClient | null } = {},
) {
  const now = () => new Date(deps.now());

  async function eventView(event: EventInfo): Promise<EventView> {
    const left = await availability(db, event, now());
    return eventViewOf(event, { isQueueActive: false, availableFor: (tierId) => left.get(tierId) ?? 0 });
  }

  async function holdDetails(holdId: string): Promise<Result<HoldDetailsView>> {
    const details = await readHold(db, deps, { holdId }, (context, { hold }) => ({ context, hold }));
    if (!details) return notFound("That reservation doesn’t exist.");
    const event = await eventView(getEvent(details.hold.eventSlug));
    return ok(toHoldDetailsView(details.context, details.hold, event));
  }

  /** A payment command, run by the sandbox's rules on its hold's records, under the hold's lock. */
  async function onPayment(
    reference: HoldReference,
    missing: string,
    run: (context: BackendContext) => Result<PaymentAttempt>,
  ): Promise<Result<PaymentResultView>> {
    const result = await withHold(db, deps, reference, (context) =>
      map(run(context), (attempt) => toPaymentResultView(context, attempt)),
    );
    return result ?? notFound(missing);
  }

  /**
   * Open a Razorpay checkout for the order. Razorpay's order is made first, over the
   * network and so outside any lock, once the order is known to be payable; then the
   * payment is recorded under the hold's lock, where the rules check it all again. If
   * that fails, or the process dies in between, Razorpay keeps an order nobody pays,
   * which costs nothing. A retry with the same Idempotency-Key is replayed, not re-run.
   */
  async function openCheckout(client: RazorpayClient, orderId: string): Promise<Result<PaymentResultView>> {
    const payable = await readHold(db, deps, { orderId }, (context) =>
      map(checkPayable(context, orderId, "razorpay"), (order) => order.amounts),
    );
    if (!payable) return notFound("That order doesn’t exist.");
    if (!payable.ok) return payable;
    const { totalMinor: amountMinor, currency } = payable.value;
    const paymentId = deps.newId("pay");
    let providerOrderId: string;
    try {
      ({ id: providerOrderId } = await client.createOrder({
        amountMinor,
        currency,
        receipt: paymentId,
        notes: { order_id: orderId, payment_id: paymentId },
      }));
    } catch (error) {
      if (!(error instanceof RazorpayError && error.isRetryable)) throw error;
      console.error(`[razorpay] ${error.message}`);
      return fail({ code: "service_unavailable", detail: "Razorpay couldn’t be reached just now. Try again." });
    }
    return onPayment({ orderId }, "That order doesn’t exist.", (context) =>
      createPayment(context, orderId, { method: "razorpay" }, { paymentId, providerOrderId, amountMinor }),
    );
  }

  /**
   * Checkout's signed result, which settles the payment without waiting for the webhook
   * (and where no webhook can reach, as on a laptop). The signature proves the ids are
   * Razorpay's; what was paid is then asked of Razorpay, never taken from the browser.
   * A payment already settled is answered as it stands.
   */
  async function confirmCheckout(
    paymentId: string,
    { razorpayOrderId, razorpayPaymentId, razorpaySignature }: ConfirmRazorpayRequest,
  ): Promise<Result<PaymentResultView>> {
    const view = () =>
      readHold(db, deps, { paymentId }, (context) => {
        const payment = context.state.payments[paymentId];
        const order = payment ? context.state.orders[payment.orderId] : undefined;
        return payment && order ? toPaymentResultView(context, { payment, order }) : null;
      });
    const known = await readHold(db, deps, { paymentId }, (context) => context.state.payments[paymentId] ?? null);
    if (!razorpay || !known) return notFound("That payment doesn’t exist.");
    if (known.method !== "razorpay" || known.providerOrderId !== razorpayOrderId) {
      return fail({ code: "invalid_state", detail: "That isn’t this payment’s checkout." });
    }
    if (!razorpay.isCheckoutResult(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return fail({ code: "invalid_signature", detail: "Checkout’s signature doesn’t match." });
    }
    let paid: RazorpayPayment;
    try {
      paid = await razorpay.fetchPayment(razorpayPaymentId);
    } catch (error) {
      if (!(error instanceof RazorpayError && error.isRetryable)) throw error;
      console.error(`[razorpay] ${error.message}`);
      // Razorpay's webhook will settle it; the order page waits for that.
      return fail({ code: "service_unavailable", detail: "Razorpay couldn’t be reached just now. Try again." });
    }
    if (paid.order_id !== razorpayOrderId) {
      return fail({ code: "invalid_state", detail: "That isn’t this payment’s checkout." });
    }
    await settleRazorpayPayment(db, deps, paid);
    const settled = await view();
    return settled ? ok(settled) : notFound("That payment doesn’t exist.");
  }

  const port = {
    chaos: () => SERVER_SETTINGS,
    idempotency: createIdempotencyStore(db, deps),
    /** The server's record of what happened is its request log, not the sandbox's panel. */
    log: () => undefined,

    listEvents: (): Promise<EventView[]> => Promise.all(CATALOG.map(eventView)),

    async getEvent(slug: string): Promise<Result<EventView>> {
      const event = findEvent(slug);
      return event ? ok(await eventView(event)) : fail({ code: "not_found", detail: "No such event." });
    },

    async getSeatAvailability(eventSlug: string): Promise<Result<SeatAvailabilityView>> {
      const event = findEvent(eventSlug);
      if (!event) return fail({ code: "not_found", detail: "No such event." });
      if (!isReservedEvent(event)) return fail({ code: "not_found", detail: "This event has no reserved seats." });
      return ok({
        eventSlug,
        unavailableSeatIds: [...(await unavailableSeatIds(db, eventSlug, now()))],
        serverTimeMs: deps.now(),
      });
    },

    /** There's no waiting room on the server, so the queue token isn't needed. */
    async createHold(command: CreateHoldCommand): Promise<Result<HoldDetailsView>> {
      const event = findEvent(command.eventSlug);
      if (!event) return fail({ code: "not_found", detail: "No such event." });
      const createdAt = now();
      const draft = {
        id: deps.newId("hold"),
        eventSlug: event.slug,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + SERVER_SETTINGS.holdDurationMs),
      };
      const held =
        "seatIds" in command
          ? await holdSeats(db, event, draft, command.seatIds)
          : await holdByTiers(db, event, draft, command.items);
      return held.ok ? holdDetails(held.value.id) : held;
    },

    getHold: holdDetails,

    async upsertOrder(input: UpsertOrderCommand): Promise<Result<{ order: OrderView; isCreated: boolean }>> {
      const result = await withHold(db, deps, { holdId: input.holdId }, (context) =>
        map(upsertOrder(context, input), ({ order, isCreated }) => ({ order: toOrderView(context, order), isCreated })),
      );
      return result ?? notFound("That reservation doesn’t exist.");
    },

    async getOrder(orderId: string): Promise<Result<OrderView>> {
      const result = await readHold(db, deps, { orderId }, (context) =>
        map(findOrder(context, orderId), (order) => toOrderView(context, order)),
      );
      return result ?? notFound("That order doesn’t exist.");
    },

    // Which ways to pay are taken is the provider's to say (`ServerDeps.paymentMethods`).
    createPayment: (orderId: string, input: PaymentInput) =>
      input.method === "razorpay" && razorpay
        ? openCheckout(razorpay, orderId)
        : onPayment({ orderId }, "That order doesn’t exist.", (context) => createPayment(context, orderId, input)),
    confirmChallenge: (paymentId: string, decision: ChallengeDecision) =>
      onPayment({ paymentId }, "That payment doesn’t exist.", (context) =>
        confirmChallenge(context, paymentId, decision),
      ),
    cancelPayment: (paymentId: string) =>
      onPayment({ paymentId }, "That payment doesn’t exist.", (context) => cancelPayment(context, paymentId)),
  } satisfies BuyerPort;
  // Razorpay's alone, beside the port both backends share.
  return { ...port, confirmCheckout };
}

export type PostgresBackend = ReturnType<typeof createPostgresBackend>;
