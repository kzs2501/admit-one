/**
 * The server backend's tables. Where the sandbox relies on being single-threaded, these
 * rely on the database: a row's own counters for stock, and a unique index for seats,
 * so two buyers can't both get the last ticket or the same seat, whatever the timing.
 * Times are stored as `timestamptz` and always come from the app's clock, never the
 * database's `now()`, so tests on a fake clock behave exactly as the sandbox's do.
 */
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Amounts } from "@/core/pricing";
import { HOLD_STATUSES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from "@/core/statuses";
import type { LineItem } from "@/core/ticketing";
import type { JsonValue, OrderRecord } from "@/backend/domain/state";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A column's own vocabulary, held by the database too: a status the code doesn't know
 * can't be written, by a bug or by hand. The values are the app's own constants, so
 * they're written into the constraint as they are (DDL takes no parameters).
 */
const isOneOf = (column: SQLWrapper, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;

const SEAT_CLAIM_STATUSES = ["held", "sold"] as const;

/**
 * Tickets of each general-admission tier. `sold` includes those sold before the demo;
 * `held` counts tickets in holds not yet released. Holding is one conditional update of
 * this row (see `holds.ts`), and the check is the database's own promise that a bug
 * elsewhere still can't oversell.
 */
export const inventory = pgTable(
  "inventory",
  {
    tierId: text("tier_id").primaryKey(),
    eventSlug: text("event_slug").notNull(),
    capacity: integer("capacity").notNull(),
    sold: integer("sold").notNull().default(0),
    held: integer("held").notNull().default(0),
  },
  (table) => [
    check(
      "inventory_within_capacity",
      sql`${table.sold} >= 0 AND ${table.held} >= 0 AND ${table.sold} + ${table.held} <= ${table.capacity}`,
    ),
  ],
);

export const holds = pgTable(
  "holds",
  {
    id: text("id").primaryKey(),
    eventSlug: text("event_slug").notNull(),
    items: jsonb("items").$type<LineItem[]>().notNull(),
    /** Reserved seating: the seats held, in the order they'll go to attendees. */
    seatIds: text("seat_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: HOLD_STATUSES }).notNull().default("active"),
    /** Payment start may extend a hold once, so a buyer mid-payment isn't cut off. */
    isExtended: boolean("is_extended").notNull().default(false),
    orderId: text("order_id"),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    index("holds_active_by_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
    check("holds_status_known", isOneOf(table.status, HOLD_STATUSES)),
  ],
);

/**
 * One row per seat that's taken: held, or sold. The partial unique index is the lock:
 * the database refuses a second unreleased claim on a seat, however the requests
 * interleave. A sale updates the claim in place, so there's never a moment between
 * "held" and "sold" when the seat looks free.
 */
export const seatClaims = pgTable(
  "seat_claims",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventSlug: text("event_slug").notNull(),
    seatId: text("seat_id").notNull(),
    /** Null for seats sold before the demo. */
    holdId: text("hold_id").references(() => holds.id),
    status: text("status", { enum: SEAT_CLAIM_STATUSES }).notNull(),
    claimedAt: at("claimed_at").notNull(),
    releasedAt: at("released_at"),
  },
  (table) => [
    uniqueIndex("one_claim_per_seat")
      .on(table.eventSlug, table.seatId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("seat_claims_by_hold").on(table.holdId),
    check("seat_claims_status_known", isOneOf(table.status, SEAT_CLAIM_STATUSES)),
  ],
);

/** An order, one per hold. Its smaller parts are JSON, kept whole, as the order is. */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    holdId: text("hold_id")
      .notNull()
      .unique()
      .references(() => holds.id),
    eventSlug: text("event_slug").notNull(),
    items: jsonb("items").$type<LineItem[]>().notNull(),
    attendees: jsonb("attendees").$type<OrderRecord["attendees"]>().notNull(),
    addOns: jsonb("add_ons").$type<Record<string, number>>().notNull(),
    amounts: jsonb("amounts").$type<Amounts>().notNull(),
    status: text("status").$type<OrderRecord["status"]>().notNull(),
    statusReason: text("status_reason"),
    tickets: jsonb("tickets").$type<OrderRecord["tickets"]>().notNull(),
    paymentId: text("payment_id"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (table) => [check("orders_status_known", isOneOf(table.status, ORDER_STATUSES))],
);

/** Every payment attempt: by card (with its last four digits) or by UPI (with when the request runs out). */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    last4: text("last4"),
    upiExpiresAt: at("upi_expires_at"),
    /** Razorpay's order, which the buyer's checkout pays; null for the simulated provider. */
    providerOrderId: text("provider_order_id"),
    /** Razorpay's payment against it, once there is one. */
    providerPaymentId: text("provider_payment_id"),
    /** How the buyer paid on Razorpay's page: card, upi, netbanking… */
    instrument: text("instrument"),
    checkoutExpiresAt: at("checkout_expires_at"),
    webhookLagMs: integer("webhook_lag_ms"),
    createdAt: at("created_at").notNull(),
  },
  (table) => [
    index("payments_by_order").on(table.orderId),
    // Razorpay's webhooks and Checkout name its ids, never ours.
    uniqueIndex("payments_by_provider_order").on(table.providerOrderId),
    uniqueIndex("payments_by_provider_payment").on(table.providerPaymentId),
    check("payments_status_known", isOneOf(table.status, PAYMENT_STATUSES)),
    check("payments_method_known", isOneOf(table.method, PAYMENT_METHODS)),
  ],
);

/**
 * Idempotency-Keys, claimed before the work starts. A row with no status is a request
 * still in flight; a status and body are the answer, replayed to retries for 24 hours.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    status: integer("status"),
    body: jsonb("body").$type<JsonValue>(),
    createdAt: at("created_at").notNull(),
  },
  // Keys past their 24 hours are purged by age, so the purge doesn't read every key.
  (table) => [index("idempotency_keys_created_at").on(table.createdAt)],
);

/**
 * The simulated provider's outbox: each event it will send, when, and whether it has.
 * Providers deliver at least once, so the same event may have more than one delivery.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    deliveryId: text("delivery_id").primaryKey(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    paymentId: text("payment_id"),
    failureCode: text("failure_code"),
    enqueuedAt: at("enqueued_at").notNull(),
    deliverAt: at("deliver_at").notNull(),
    deliveredAt: at("delivered_at"),
    /** Failed deliveries so far; each failure puts the next try further off. */
    attempts: integer("attempts").notNull().default(0),
    /** When to try again after a failure. `deliver_at` stays when the provider confirmed. */
    nextAttemptAt: at("next_attempt_at"),
    lastError: text("last_error"),
    /** A sender has the event to itself until then, so another doesn't send it too. */
    leaseUntil: at("lease_until"),
  },
  (table) => [
    index("provider_events_due")
      .on(table.deliverAt)
      .where(sql`${table.deliveredAt} IS NULL`),
  ],
);

/** Webhook events already processed: the insert that deduplicates them commits with their effect. */
export const webhookEvents = pgTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: at("received_at").notNull(),
});

/**
 * Reservation attempts, per client, for the rate limit (`rate-limit.ts`). Only a
 * client's newest few attempts ever decide an answer, so only those are kept.
 */
export const holdAttempts = pgTable(
  "hold_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    clientKey: text("client_key").notNull(),
    at: at("at").notNull(),
  },
  (table) => [
    index("hold_attempts_by_client").on(table.clientKey, table.at),
    // Clients that have gone quiet are forgotten by age.
    index("hold_attempts_by_age").on(table.at),
  ],
);
