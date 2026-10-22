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
import type { Database } from "./db";
import type { BuyerPort } from "@/backend/port";
import { createIdempotencyStore } from "./idempotency";
import { SERVER_SETTINGS, type ServerDeps } from "./records";
import { availability, holdByTiers, holdSeats, unavailableSeatIds } from "./stock";
import { readHold, withHold, type HoldReference } from "./unit-of-work";

const notFound = (detail: string) => fail({ code: "not_found", detail });

const toPaymentResultView = (context: BackendContext, { payment, order }: PaymentAttempt): PaymentResultView => ({
  payment: toPaymentView(context, payment),
  order: toOrderView(context, order),
});

export function createPostgresBackend(db: Database, deps: ServerDeps) {
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

  return {
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

    createPayment: (orderId: string, input: PaymentInput) =>
      // UPI is approved in the buyer's own app, which only a real provider can reach:
      // the sandbox simulates that app, the server has none, so it takes cards.
      input.method === "upi"
        ? Promise.resolve(
            fail({
              code: "payment_method_unavailable",
              detail: "Paying by UPI needs a real payment provider. This server takes cards.",
            }),
          )
        : onPayment({ orderId }, "That order doesn’t exist.", (context) => createPayment(context, orderId, input)),
    confirmChallenge: (paymentId: string, decision: ChallengeDecision) =>
      onPayment({ paymentId }, "That payment doesn’t exist.", (context) =>
        confirmChallenge(context, paymentId, decision),
      ),
    cancelPayment: (paymentId: string) =>
      onPayment({ paymentId }, "That payment doesn’t exist.", (context) => cancelPayment(context, paymentId)),
  } satisfies BuyerPort;
}

export type PostgresBackend = ReturnType<typeof createPostgresBackend>;
