/**
 * The simulated backend. Plain functions over plain state, with time, ids and
 * randomness injected — so every rule here runs identically in a unit test (with a
 * fake clock) and in the browser (behind MSW).
 *
 * Each operation returns a Result carrying an HTTP status, which the MSW handlers
 * turn into a Response. This file is the "controller + service" layer of a real API.
 */
import { catalog, findTier, getEventInfo, type EventInfo } from "@/shared/catalog";
import type { EventView, HoldResponse, HoldView, OrderStatus, OrderView, PaymentView } from "@/shared/api-types";
import { priceOrder, ticketCount } from "@/shared/money";
import { cardSchema, createHoldSchema, upsertOrderSchema } from "@/shared/schemas";
import { getPreset, type ChaosConfig, type PresetId } from "./chaos";
import { assertTransition } from "./order-machine";
import {
  initialState,
  type HoldRecord,
  type LogKind,
  type OrderRecord,
  type PaymentRecord,
  type ServerState,
} from "./state";

export type Deps = {
  now: () => number;
  newId: (prefix: string) => string;
  random: () => number;
};

export type ApiError = { status: number; code: string; message: string; details?: Record<string, unknown> };
export type Result<T> = { ok: true; status: number; value: T } | { ok: false; error: ApiError };

const ok = <T>(value: T, status = 200): Result<T> => ({ ok: true, status, value });
const fail = (status: number, code: string, message: string, details?: Record<string, unknown>): Result<never> => ({
  ok: false,
  error: { status, code, message, details },
});

/** How long starting a payment keeps a hold alive, so a buyer mid-payment isn't cut off. */
export const PAYMENT_GRACE_MS = 2 * 60_000;
/** The "hold expires mid-payment" preset leaves this long on the clock. */
export const LAST_SECONDS_MS = 3_000;
/** Gap between the two deliveries in the "webhook arrives twice" preset. */
export const DUPLICATE_GAP_MS = 700;

const LOG_LIMIT = 120;

/** Card numbers with special meaning, as payment providers' test modes have. */
export const TEST_CARDS = {
  success: "4242424242424242",
  decline: "4000000000000002",
  challenge: "4000002500003155",
} as const;

export function createServer(deps: Deps, initial: ServerState = initialState()) {
  let state = initial;
  const listeners = new Set<() => void>();
  // State is mutated in place, so subscribers (React's useSyncExternalStore) need a
  // value that changes on every update to know something happened.
  let version = 0;

  const notify = () => {
    version += 1;
    listeners.forEach((l) => l());
  };
  const chaos = (): ChaosConfig => getPreset(state.presetId).config;

  function log(kind: LogKind, message: string) {
    state.logSeq += 1;
    state.log.push({ id: state.logSeq, at: deps.now(), kind, message });
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  // ── Inventory ───────────────────────────────────────────────────────────────

  const holdIsLive = (hold: HoldRecord, now = deps.now()) => !hold.converted && now < hold.expiresAt;

  /**
   * capacity − baseline sold − sold here − tickets in live holds.
   * Expiry is lazy: an expired hold simply stops counting. Nothing runs on a timer
   * to "release" it, so there's no window where a dead hold still blocks a buyer.
   */
  function available(tierId: string, now = deps.now()): number {
    const found = findTier(tierId);
    if (!found) return 0;
    const { tier } = found;
    let held = 0;
    for (const hold of Object.values(state.holds)) {
      if (!holdIsLive(hold, now)) continue;
      for (const item of hold.items) if (item.tierId === tierId) held += item.qty;
    }
    return Math.max(0, tier.capacity - tier.baselineSold - (state.sold[tierId] ?? 0) - held);
  }

  const eventView = (event: EventInfo): EventView => ({
    ...event,
    tiers: event.tiers.map((t) => ({ ...t, available: available(t.id) })),
  });

  const holdView = (hold: HoldRecord): HoldView => ({
    id: hold.id,
    eventSlug: hold.eventSlug,
    items: hold.items,
    createdAt: hold.createdAt,
    expiresAt: hold.expiresAt,
    status: hold.converted ? "converted" : holdIsLive(hold) ? "active" : "expired",
    orderId: hold.orderId,
  });

  /** The crowd buys tickets outright (no checkout of their own). */
  function crowdBuys(tierId: string, qty: number, why: string) {
    state.sold[tierId] = (state.sold[tierId] ?? 0) + qty;
    log("crowd", `Another buyer took ${qty} × ${findTier(tierId)?.tier.name} (${why}).`);
  }

  // ── Orders and payments: views ──────────────────────────────────────────────

  const paymentInFlight = (order: OrderRecord) => {
    const p = order.paymentId ? state.payments[order.paymentId] : undefined;
    return p?.status === "processing" || p?.status === "requires_action";
  };

  /**
   * An unpaid order whose hold has run out is expired — derived, not stored, so a
   * read never has to write. (A payment in flight protects the order: its webhook
   * decides what happens.)
   */
  function effectiveStatus(order: OrderRecord): { status: OrderStatus; reason: string | null } {
    if ((order.status === "pending" || order.status === "failed") && !paymentInFlight(order)) {
      const hold = state.holds[order.holdId];
      if (hold && !holdIsLive(hold)) {
        return { status: "expired", reason: "Your reservation expired before payment was completed." };
      }
    }
    return { status: order.status, reason: order.statusReason };
  }

  const paymentView = (p: PaymentRecord): PaymentView => ({
    id: p.id,
    status: p.status,
    last4: p.last4,
    failureCode: p.failureCode,
  });

  function orderView(order: OrderRecord): OrderView {
    const { status, reason } = effectiveStatus(order);
    const payment = order.paymentId ? state.payments[order.paymentId] : null;
    return {
      id: order.id,
      holdId: order.holdId,
      eventSlug: order.eventSlug,
      items: order.items,
      attendees: order.attendees,
      addOns: order.addOns,
      amounts: order.amounts,
      status,
      statusReason: reason,
      tickets: order.tickets,
      payment: payment ? paymentView(payment) : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  function setStatus(order: OrderRecord, to: OrderStatus, reason: string | null = null) {
    assertTransition(order.status, to);
    log("order", `Order ${order.id}: ${order.status} → ${to}${reason ? ` (${reason})` : ""}.`);
    order.status = to;
    order.statusReason = reason;
    order.updatedAt = deps.now();
  }

  /** Persist a derived expiry when a write path runs into it. */
  function settleExpiry(order: OrderRecord) {
    const { status, reason } = effectiveStatus(order);
    if (status === "expired" && order.status !== "expired") setStatus(order, "expired", reason);
  }

  function ticketCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L
    return Array.from({ length: 8 }, () => alphabet[Math.floor(deps.random() * alphabet.length)]).join("");
  }

  function issueTickets(order: OrderRecord) {
    const event = getEventInfo(order.eventSlug)!;
    const tierNames = order.items.flatMap(({ tierId, qty }) =>
      Array.from({ length: qty }, () => event.tiers.find((t) => t.id === tierId)?.name ?? tierId),
    );
    order.tickets = order.attendees.map((a, i) => ({
      code: ticketCode(),
      attendeeName: a.name,
      tierName: tierNames[i],
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────────

  function enqueueSucceeded(payment: PaymentRecord) {
    const eventId = deps.newId("evt");
    const deliverAt = deps.now() + chaos().webhookDelayMs;
    state.outbox.push({
      deliveryId: deps.newId("dlv"),
      eventId,
      type: "payment.succeeded",
      paymentId: payment.id,
      deliverAt,
    });
    if (chaos().duplicateWebhook) {
      state.outbox.push({
        deliveryId: deps.newId("dlv"),
        eventId,
        type: "payment.succeeded",
        paymentId: payment.id,
        deliverAt: deliverAt + DUPLICATE_GAP_MS,
      });
    }
  }

  /**
   * The webhook, not the browser's redirect, is the source of truth for whether a
   * payment happened. Processing is idempotent by event id: providers deliver at
   * least once, so duplicates are normal, not errors.
   */
  function processWebhook(eventId: string, paymentId: string) {
    if (state.processedEvents.includes(eventId)) {
      log("webhook", `payment.succeeded ${eventId} arrived again — already processed, ignored.`);
      return;
    }
    state.processedEvents.push(eventId);

    const payment = state.payments[paymentId];
    const order = payment ? state.orders[payment.orderId] : undefined;
    if (!payment || !order) {
      log("warn", `Webhook ${eventId} refers to an unknown payment; ignored.`);
      return;
    }
    if (order.status !== "pending" && order.status !== "failed") {
      log("warn", `Webhook ${eventId} for ${order.id}, which is already ${order.status}; ignored.`);
      return;
    }
    log("webhook", `payment.succeeded ${eventId} received for ${payment.id}.`);
    payment.status = "succeeded";

    if (order.status === "failed") setStatus(order, "pending");
    setStatus(order, "paid");

    const hold = state.holds[order.holdId];
    if (hold && holdIsLive(hold)) {
      hold.converted = true;
      for (const { tierId, qty } of hold.items) state.sold[tierId] = (state.sold[tierId] ?? 0) + qty;
      issueTickets(order);
      setStatus(order, "fulfilled");
    } else {
      // The money arrived but the tickets may already belong to someone else. The
      // policy: refund in full and say why, rather than oversell or keep the money.
      payment.status = "refunded";
      log("payment", `Refunded ${payment.id}: the hold expired before the payment was confirmed.`);
      setStatus(
        order,
        "refunded",
        "Your payment went through after your reservation had expired, so we’ve refunded it in full.",
      );
    }
  }

  // ── Public operations ───────────────────────────────────────────────────────

  return {
    getState: () => state,
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chaos,
    setPreset(id: PresetId) {
      state.presetId = id;
      log("request", `Chaos preset: ${getPreset(id).label}.`);
      notify();
    },
    /** Start a fresh sandbox, keeping the chosen preset. */
    reset() {
      state = initialState(state.presetId);
      log("request", "Sandbox reset.");
      notify();
    },
    log(kind: LogKind, message: string) {
      log(kind, message);
      notify();
    },

    listEvents: (): Result<EventView[]> => ok(catalog.map(eventView)),

    getEvent(slug: string): Result<EventView> {
      const event = getEventInfo(slug);
      return event ? ok(eventView(event)) : fail(404, "not_found", "No such event.");
    },

    createHold(body: unknown): Result<HoldResponse> {
      const parsed = createHoldSchema.safeParse(body);
      if (!parsed.success) return fail(422, "invalid_request", parsed.error.issues[0].message);
      const { eventSlug, items } = parsed.data;
      const event = getEventInfo(eventSlug);
      if (!event) return fail(404, "not_found", "No such event.");
      for (const { tierId } of items) {
        if (!event.tiers.some((t) => t.id === tierId)) return fail(422, "invalid_request", "Unknown ticket type.");
      }

      // The crowd snipes nearly-sold-out tiers a moment before the visitor's request.
      if (chaos().crowd) {
        for (const { tierId } of items) {
          const left = available(tierId);
          if (left > 0 && left <= 2) crowdBuys(tierId, left, "a moment before you");
        }
      }

      // In a real database this check and the insert below would be one
      // transaction (or a conditional update), so two buyers can't both pass it.
      // Here the server is single-threaded, which makes it atomic by construction.
      for (const { tierId, qty } of items) {
        const left = available(tierId);
        if (left < qty) {
          notify();
          return fail(
            409,
            "sold_out",
            left === 0 ? "Those tickets just sold out." : `Only ${left} left for that ticket type.`,
            { tierId, available: left },
          );
        }
      }

      const now = deps.now();
      const hold: HoldRecord = {
        id: deps.newId("hold"),
        eventSlug,
        items,
        createdAt: now,
        expiresAt: now + chaos().holdSeconds * 1000,
        converted: false,
        extended: false,
        orderId: null,
      };
      state.holds[hold.id] = hold;
      log(
        "hold",
        `Hold ${hold.id} created: ${items.map((i) => `${i.qty} × ${findTier(i.tierId)?.tier.name}`).join(", ")}.`,
      );
      notify();
      return ok({ hold: holdView(hold), event: eventView(event), order: null, serverNow: now }, 201);
    },

    getHold(id: string): Result<HoldResponse> {
      const hold = state.holds[id];
      if (!hold) return fail(404, "not_found", "That reservation doesn’t exist.");
      const order = hold.orderId ? state.orders[hold.orderId] : undefined;
      return ok({
        hold: holdView(hold),
        event: eventView(getEventInfo(hold.eventSlug)!),
        order: order ? orderView(order) : null,
        serverNow: deps.now(),
      });
    },

    /**
     * One order per hold, so this is naturally idempotent: calling it twice updates
     * the same order instead of creating two. (Payments, which can't be keyed by
     * anything natural, use an explicit Idempotency-Key instead.)
     */
    upsertOrder(body: unknown): Result<OrderView> {
      const parsed = upsertOrderSchema.safeParse(body);
      if (!parsed.success) return fail(422, "invalid_request", parsed.error.issues[0].message);
      const { holdId, attendees, addOns } = parsed.data;
      const hold = state.holds[holdId];
      if (!hold) return fail(404, "not_found", "That reservation doesn’t exist.");
      if (hold.converted) return fail(409, "already_completed", "This order is already complete.");

      const event = getEventInfo(hold.eventSlug)!;
      const count = ticketCount(hold.items);
      if (attendees.length !== count) {
        return fail(422, "invalid_request", `Add details for all ${count} tickets.`);
      }
      for (const [id, qty] of Object.entries(addOns)) {
        if (!event.addOns.some((a) => a.id === id)) return fail(422, "invalid_request", "Unknown add-on.");
        if (qty > count) return fail(422, "invalid_request", "You can add at most one of each extra per ticket.");
      }
      const cleanAddOns = Object.fromEntries(Object.entries(addOns).filter(([, qty]) => qty > 0));

      const now = deps.now();
      const existing = hold.orderId ? state.orders[hold.orderId] : undefined;
      if (existing) {
        settleExpiry(existing);
        if (paymentInFlight(existing)) return fail(409, "payment_in_progress", "A payment is already in progress.");
        if (existing.status !== "pending" && existing.status !== "failed") {
          return existing.status === "expired"
            ? fail(410, "hold_expired", "Your reservation expired.")
            : fail(409, "already_completed", "This order can no longer be changed.");
        }
        existing.attendees = attendees;
        existing.addOns = cleanAddOns;
        existing.amounts = priceOrder(event, hold.items, cleanAddOns);
        existing.updatedAt = now;
        log("order", `Order ${existing.id} updated.`);
        notify();
        return ok(orderView(existing));
      }

      if (!holdIsLive(hold)) return fail(410, "hold_expired", "Your reservation expired.");
      const order: OrderRecord = {
        id: deps.newId("ord"),
        holdId,
        eventSlug: hold.eventSlug,
        items: hold.items,
        attendees,
        addOns: cleanAddOns,
        amounts: priceOrder(event, hold.items, cleanAddOns),
        status: "pending",
        statusReason: null,
        tickets: [],
        paymentId: null,
        createdAt: now,
        updatedAt: now,
      };
      state.orders[order.id] = order;
      hold.orderId = order.id;
      log("order", `Order ${order.id} created for hold ${hold.id} (pending).`);
      notify();
      return ok(orderView(order), 201);
    },

    getOrder(id: string): Result<OrderView> {
      const order = state.orders[id];
      return order ? ok(orderView(order)) : fail(404, "not_found", "That order doesn’t exist.");
    },

    /**
     * Start a payment. The Idempotency-Key makes retries safe: the same key always
     * gets the same response, so a double-click or a retried request can never
     * charge twice.
     */
    createPayment(
      orderId: string,
      body: unknown,
      idempotencyKey: string | null,
    ): Result<{ payment: PaymentView; order: OrderView }> {
      if (!idempotencyKey) return fail(400, "missing_idempotency_key", "Payments need an Idempotency-Key header.");

      const parsedCard = cardSchema.safeParse(body);
      const fingerprint = `${orderId}:${parsedCard.success ? parsedCard.data.number.slice(-4) : "invalid"}`;
      const replay = state.idempotency[idempotencyKey];
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          return fail(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
        }
        log("payment", `Idempotency-Key replayed — returning the original response, no new charge.`);
        notify();
        return replay.status < 400
          ? ok(replay.body as { payment: PaymentView; order: OrderView }, replay.status)
          : { ok: false, error: replay.body as ApiError };
      }

      const order = state.orders[orderId];
      if (!order) return fail(404, "not_found", "That order doesn’t exist.");
      settleExpiry(order);
      if (order.status === "expired") {
        notify();
        return fail(410, "hold_expired", "Your reservation expired before payment.");
      }
      if (paymentInFlight(order)) return fail(409, "payment_in_progress", "A payment is already in progress.");
      if (order.status !== "pending" && order.status !== "failed") {
        return fail(409, "already_completed", "This order is already paid.");
      }
      if (!parsedCard.success) return fail(422, "invalid_card", parsedCard.error.issues[0].message);

      const now = deps.now();
      const number = parsedCard.data.number;
      const outcome =
        chaos().forceOutcome ??
        (number === TEST_CARDS.decline ? "decline" : number === TEST_CARDS.challenge ? "challenge" : "success");

      if (order.status === "failed") setStatus(order, "pending", "retrying payment");

      const payment: PaymentRecord = {
        id: deps.newId("pay"),
        orderId,
        amountCents: order.amounts.totalCents,
        status: outcome === "decline" ? "failed" : outcome === "challenge" ? "requires_action" : "processing",
        last4: number.slice(-4),
        failureCode: outcome === "decline" ? "card_declined" : null,
        createdAt: now,
      };
      state.payments[payment.id] = payment;
      order.paymentId = payment.id;
      log("payment", `Payment ${payment.id} for ${order.id}: ${payment.status}.`);

      let result: Result<{ payment: PaymentView; order: OrderView }>;
      if (outcome === "decline") {
        setStatus(order, "failed", "Your card was declined.");
        result = fail(402, "card_declined", "Your card was declined. Try a different card.", {
          payment: paymentView(payment),
        });
      } else {
        const hold = state.holds[order.holdId];
        if (chaos().expireHoldDuringPayment) {
          hold.expiresAt = now + LAST_SECONDS_MS;
          log("hold", `Hold ${hold.id} has ${LAST_SECONDS_MS / 1000}s left as payment starts.`);
        } else if (!hold.extended) {
          hold.expiresAt = Math.max(hold.expiresAt, now + PAYMENT_GRACE_MS);
          hold.extended = true;
          log("hold", `Hold ${hold.id} extended while the payment completes.`);
        }
        if (outcome === "success") enqueueSucceeded(payment);
        result = ok({ payment: paymentView(payment), order: orderView(order) }, 202);
      }

      state.idempotency[idempotencyKey] = {
        fingerprint,
        status: result.ok ? result.status : result.error.status,
        body: result.ok ? result.value : result.error,
      };
      notify();
      return result;
    },

    /** The buyer's answer to the bank's authentication challenge. */
    confirmChallenge(paymentId: string, approve: boolean): Result<{ payment: PaymentView; order: OrderView }> {
      const payment = state.payments[paymentId];
      if (!payment) return fail(404, "not_found", "That payment doesn’t exist.");
      if (payment.status !== "requires_action")
        return fail(409, "invalid_state", "That payment isn’t waiting for authentication.");
      const order = state.orders[payment.orderId];

      if (approve) {
        payment.status = "processing";
        log("payment", `Payment ${payment.id} authenticated; processing.`);
        enqueueSucceeded(payment);
        notify();
        return ok({ payment: paymentView(payment), order: orderView(order) }, 202);
      }
      payment.status = "failed";
      payment.failureCode = "authentication_failed";
      setStatus(order, "failed", "Your bank couldn’t authenticate the payment.");
      notify();
      return fail(402, "authentication_failed", "Authentication failed. Try again or use a different card.", {
        payment: paymentView(payment),
      });
    },

    /** When the next webhook is due, so the runtime can sleep until then. */
    nextDeliveryAt(): number | null {
      return state.outbox.length ? Math.min(...state.outbox.map((o) => o.deliverAt)) : null;
    },

    /** Deliver every webhook that's due. Returns how many were delivered. */
    deliverDue(): number {
      const now = deps.now();
      const due = state.outbox.filter((o) => o.deliverAt <= now).sort((a, b) => a.deliverAt - b.deliverAt);
      if (!due.length) return 0;
      state.outbox = state.outbox.filter((o) => o.deliverAt > now);
      for (const item of due) processWebhook(item.eventId, item.paymentId);
      notify();
      return due.length;
    },

    /** Background buying, so availability visibly moves while the crowd preset is on. */
    crowdTick(): boolean {
      if (!chaos().crowd) return false;
      const candidates = catalog.flatMap((e) => e.tiers).filter((t) => available(t.id) > 3);
      if (!candidates.length) return false;
      const tier = candidates[Math.floor(deps.random() * candidates.length)];
      crowdBuys(tier.id, 1, "in the background");
      notify();
      return true;
    },

    available,
  };
}

export type Server = ReturnType<typeof createServer>;
