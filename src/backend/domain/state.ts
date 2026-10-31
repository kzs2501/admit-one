/**
 * The simulated backend's entire state. It's plain JSON, so it can be persisted
 * (sessionStorage in the browser) and restored after a reload — including webhooks
 * still waiting to be delivered.
 *
 * The Zod schemas are the source of truth for the record types, and every restore
 * parses against them: persisted data is untrusted input like any other.
 */
import * as z from "@/core/zod";
import { PRESET_IDS } from "@/backend/chaos/presets";
import { CURRENCIES } from "@/core/money";
import { STORAGE_KEYS } from "@/core/persisted-names";
import { TAX_LINE_KINDS } from "@/core/pricing";
import {
  ORDER_STATUSES,
  PAYMENT_FAILURE_CODES,
  PAYMENT_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
} from "@/core/statuses";

/** Bump when the shape changes; older saves then start a fresh sandbox (see ADR 001). */
const STATE_VERSION = 15;

/** Versioned, so a save from an older shape is never even read. */
export const SANDBOX_STORAGE_KEY = STORAGE_KEYS.sandbox(STATE_VERSION);

const epochMsSchema = z.number().int().nonnegative();
const lineItemSchema = z.object({ tierId: z.string(), quantity: z.number().int().positive() });

const holdRecordSchema = z.object({
  id: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemSchema),
  /** Reserved seating: the seats held, in the order they'll go to attendees. Empty otherwise. */
  seatIds: z.array(z.string()),
  createdAtMs: epochMsSchema,
  expiresAtMs: epochMsSchema,
  isConverted: z.boolean(),
  /** Payment start may extend a hold once, so a buyer mid-payment isn't cut off. */
  isExtended: z.boolean(),
  orderId: z.string().nullable(),
});

const orderRecordSchema = z.object({
  id: z.string(),
  holdId: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemSchema),
  attendees: z.array(z.object({ name: z.string(), email: z.string() })),
  addOns: z.record(z.string(), z.number().int().positive()),
  amounts: z.object({
    currency: z.enum(CURRENCIES),
    ticketsMinor: z.number().int(),
    addOnsMinor: z.number().int(),
    feesMinor: z.number().int(),
    taxMinor: z.number().int(),
    totalMinor: z.number().int(),
    taxLines: z.array(
      z.object({
        kind: z.enum(TAX_LINE_KINDS),
        rateBasisPoints: z.number().int(),
        taxableMinor: z.number().int(),
        amountMinor: z.number().int(),
      }),
    ),
  }),
  status: z.enum(ORDER_STATUSES),
  statusReason: z.string().nullable(),
  tickets: z.array(
    z.object({
      code: z.string(),
      attendeeName: z.string(),
      tierName: z.string(),
      seatId: z.string().nullable(),
      /** Signed when issued (core/ticket-token): what the door verifies. */
      token: z.string(),
    }),
  ),
  paymentId: z.string().nullable(),
  createdAtMs: epochMsSchema,
  updatedAtMs: epochMsSchema,
});

const paymentRecordBaseSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  amountMinor: z.number().int(),
  status: z.enum(PAYMENT_STATUSES),
  failureCode: z.enum(PAYMENT_FAILURE_CODES).nullable(),
  /** How long the provider's webhook took to arrive, once it did. */
  webhookLagMs: z.number().int().nonnegative().nullable(),
  createdAtMs: epochMsSchema,
});

/** A payment by card, by UPI or through Razorpay's checkout: each has only the fields its method has. */
const paymentRecordSchema = z.discriminatedUnion("method", [
  paymentRecordBaseSchema.extend({ method: z.literal("card"), last4: z.string() }),
  paymentRecordBaseSchema.extend({
    method: z.literal("upi"),
    /** When the request stops being payable, if nobody has approved it. */
    expiresAtMs: epochMsSchema,
  }),
  paymentRecordBaseSchema.extend({
    method: z.literal("razorpay"),
    /** The Razorpay order the buyer's checkout pays. */
    providerOrderId: z.string(),
    /** Razorpay's payment, once one has been made against the order. */
    providerPaymentId: z.string().nullable(),
    /** How the buyer paid on Razorpay's page (card, upi, netbanking…), once they have. */
    instrument: z.string().nullable(),
    last4: z.string().nullable(),
    /** When the checkout stops being payable, if nobody has paid: never later than the hold. */
    expiresAtMs: epochMsSchema,
  }),
]);

const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

/** A stored HTTP response, replayed verbatim when the same Idempotency-Key comes back. */
const idempotencyRecordSchema = z.object({
  /** A hash of the request the key was first used with. */
  fingerprint: z.string(),
  status: z.number().int(),
  body: jsonValueSchema,
  createdAtMs: epochMsSchema,
});

/** A place in a sale's waiting room. The line's pace is copied in, so changing the preset mid-queue can't move it. */
const queueEntryRecordSchema = z.object({
  token: z.string(),
  eventSlug: z.string(),
  joinedAtMs: epochMsSchema,
  aheadAtJoin: z.number().int().nonnegative(),
  admittedPerBatch: z.number().int().positive(),
  batchIntervalMs: z.number().int().positive(),
  admissionWindowMs: z.number().int().positive(),
});

const outboxItemBaseSchema = z.object({
  deliveryId: z.string(),
  eventId: z.string(),
  /** When the provider sent it: the start of its lag. */
  enqueuedAtMs: epochMsSchema,
  deliverAtMs: epochMsSchema,
});

/** A webhook waiting to be delivered: the outbox pattern. A payment happened or didn't; a refund went through. */
const outboxItemSchema = z.discriminatedUnion("type", [
  outboxItemBaseSchema.extend({ type: z.literal("payment.succeeded"), paymentId: z.string() }),
  outboxItemBaseSchema.extend({
    type: z.literal("payment.failed"),
    paymentId: z.string(),
    failureCode: z.enum(["upi_declined"]),
  }),
  outboxItemBaseSchema.extend({ type: z.literal("refund.succeeded"), refundId: z.string() }),
]);

/**
 * A sale to another buyer (the crowd), kept small: who they were and what they paid is
 * worked out from `seq`, like the history, so only what they bought is stored.
 */
const liveSaleSchema = z.object({
  seq: z.number().int().positive(),
  tierId: z.string(),
  quantity: z.number().int().positive(),
  seatIds: z.array(z.string()),
  atMs: epochMsSchema,
});

/** A refund an organiser asked for: pending until the provider's webhook settles it. */
const refundRecordSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  eventSlug: z.string(),
  amountMinor: z.number().int().nonnegative(),
  currency: z.enum(CURRENCIES),
  reason: z.enum(REFUND_REASONS),
  status: z.enum(REFUND_STATUSES),
  /** The account that asked for it. */
  requestedBy: z.string(),
  createdAtMs: epochMsSchema,
  settledAtMs: epochMsSchema.nullable(),
});

const LOG_KINDS = ["request", "auth", "queue", "hold", "order", "payment", "webhook", "crowd", "warn"] as const;

/** An organiser's signed-in session, keyed by its bearer token. */
const sessionRecordSchema = z.object({ accountId: z.string(), expiresAtMs: epochMsSchema });

const logEntrySchema = z.object({
  id: z.number().int(),
  atMs: epochMsSchema,
  kind: z.enum(LOG_KINDS),
  message: z.string(),
});

const serverStateSchema = z.object({
  version: z.literal(STATE_VERSION),
  /** When this sandbox started. The generated order history ends here, so it stays put across reloads. */
  createdAtMs: epochMsSchema,
  presetId: z.enum(PRESET_IDS),
  /** Tickets sold in this sandbox, per tier (on top of each tier's baseline). */
  sold: z.record(z.string(), z.number().int().nonnegative()),
  /** Reserved seats sold in this sandbox (on top of each hall's baseline). */
  soldSeatIds: z.array(z.string()),
  /** Tickets sold before the sandbox that a refund has put back on sale, per tier. */
  returnedTickets: z.record(z.string(), z.number().int().nonnegative()),
  /** Seats sold before the sandbox that a refund has put back on sale. */
  releasedSeatIds: z.array(z.string()),
  /** Other buyers' sales in this sandbox, oldest first. */
  liveSales: z.array(liveSaleSchema),
  /** The "seat snatched" preset takes a requested seat once, so the retry can succeed. */
  hasSnatchedSeat: z.boolean(),
  holds: z.record(z.string(), holdRecordSchema),
  /** Waiting-room places, by token. */
  queueEntries: z.record(z.string(), queueEntryRecordSchema),
  orders: z.record(z.string(), orderRecordSchema),
  payments: z.record(z.string(), paymentRecordSchema),
  idempotency: z.record(z.string(), idempotencyRecordSchema),
  refunds: z.record(z.string(), refundRecordSchema),
  /**
   * Tickets of refunded orders, by event. They're still signed, so a door that checks
   * signatures alone would let them in: organisers' scanners download these codes.
   */
  voidedTickets: z.record(z.string(), z.array(z.object({ code: z.string(), voidedAtMs: epochMsSchema }))),
  /** Organisers' sessions, by token. */
  sessions: z.record(z.string(), sessionRecordSchema),
  /** Webhook event ids already processed — the dedupe set. */
  processedEventIds: z.array(z.string()),
  outbox: z.array(outboxItemSchema),
  log: z.array(logEntrySchema),
  logSequence: z.number().int().nonnegative(),
});

export type HoldRecord = z.infer<typeof holdRecordSchema>;
export type OrderRecord = z.infer<typeof orderRecordSchema>;
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export type QueueEntryRecord = z.infer<typeof queueEntryRecordSchema>;
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;
export type OutboxItem = z.infer<typeof outboxItemSchema>;
export type RefundRecord = z.infer<typeof refundRecordSchema>;
export type LiveSale = z.infer<typeof liveSaleSchema>;
export type LogKind = (typeof LOG_KINDS)[number];
export type LogEntry = z.infer<typeof logEntrySchema>;
export type ServerState = z.infer<typeof serverStateSchema>;

/**
 * The record under a key that came from a request. State maps are plain objects, so
 * `holds["constructor"]` would find Object; this finds only what was stored.
 */
export function own<T>(records: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(records, key) ? records[key] : undefined;
}

export const createInitialState = (presetId: ServerState["presetId"], createdAtMs: number): ServerState => ({
  version: STATE_VERSION,
  createdAtMs,
  presetId,
  sold: {},
  soldSeatIds: [],
  returnedTickets: {},
  releasedSeatIds: [],
  liveSales: [],
  hasSnatchedSeat: false,
  holds: {},
  queueEntries: {},
  orders: {},
  payments: {},
  idempotency: {},
  refunds: {},
  voidedTickets: {},
  sessions: {},
  processedEventIds: [],
  outbox: [],
  log: [],
  logSequence: 0,
});

export const serializeState = (state: ServerState) => JSON.stringify(state);

/** Restore persisted state. Anything unreadable, foreign or from an older version starts fresh. */
export function deserializeState(raw: string | null): ServerState | null {
  if (!raw) return null;
  try {
    const parsed = serverStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
