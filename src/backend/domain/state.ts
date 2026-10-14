/**
 * The simulated backend's entire state. It's plain JSON, so it can be persisted
 * (sessionStorage in the browser) and restored after a reload — including webhooks
 * still waiting to be delivered.
 *
 * The Zod schemas are the source of truth for the record types, and every restore
 * parses against them: persisted data is untrusted input like any other.
 */
import { z } from "zod";
import { PRESET_IDS } from "@/backend/chaos/presets";
import { ORDER_STATUSES, PAYMENT_FAILURE_CODES, PAYMENT_STATUSES } from "@/core/statuses";

/** Bump when the shape changes; older saves then start a fresh sandbox (see ADR 001). */
export const STATE_VERSION = 2;

/** Versioned, so a save from an older shape is never even read. */
export const SANDBOX_STORAGE_KEY = `admit-one:sandbox:v${STATE_VERSION}`;

const epochMsSchema = z.number().int().nonnegative();
const lineItemSchema = z.object({ tierId: z.string(), quantity: z.number().int().positive() });

const holdRecordSchema = z.object({
  id: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemSchema),
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
    ticketsCents: z.number().int(),
    addOnsCents: z.number().int(),
    feesCents: z.number().int(),
    totalCents: z.number().int(),
  }),
  status: z.enum(ORDER_STATUSES),
  statusReason: z.string().nullable(),
  tickets: z.array(z.object({ code: z.string(), attendeeName: z.string(), tierName: z.string() })),
  paymentId: z.string().nullable(),
  createdAtMs: epochMsSchema,
  updatedAtMs: epochMsSchema,
});

const paymentRecordSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  amountCents: z.number().int(),
  status: z.enum(PAYMENT_STATUSES),
  last4: z.string(),
  failureCode: z.enum(PAYMENT_FAILURE_CODES).nullable(),
  createdAtMs: epochMsSchema,
});

const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

/** A stored HTTP response, replayed verbatim when the same Idempotency-Key comes back. */
const idempotencyRecordSchema = z.object({
  fingerprint: z.string(),
  status: z.number().int(),
  body: jsonValueSchema,
});

/** A webhook waiting to be delivered: the outbox pattern. */
const outboxItemSchema = z.object({
  deliveryId: z.string(),
  eventId: z.string(),
  type: z.literal("payment.succeeded"),
  paymentId: z.string(),
  deliverAtMs: epochMsSchema,
});

export const LOG_KINDS = ["request", "hold", "order", "payment", "webhook", "crowd", "warn"] as const;

const logEntrySchema = z.object({
  id: z.number().int(),
  atMs: epochMsSchema,
  kind: z.enum(LOG_KINDS),
  message: z.string(),
});

const serverStateSchema = z.object({
  version: z.literal(STATE_VERSION),
  presetId: z.enum(PRESET_IDS),
  /** Tickets sold in this sandbox, per tier (on top of each tier's baseline). */
  sold: z.record(z.string(), z.number().int().nonnegative()),
  holds: z.record(z.string(), holdRecordSchema),
  orders: z.record(z.string(), orderRecordSchema),
  payments: z.record(z.string(), paymentRecordSchema),
  idempotency: z.record(z.string(), idempotencyRecordSchema),
  /** Webhook event ids already processed — the dedupe set. */
  processedEventIds: z.array(z.string()),
  outbox: z.array(outboxItemSchema),
  log: z.array(logEntrySchema),
  logSequence: z.number().int().nonnegative(),
});

export type HoldRecord = z.infer<typeof holdRecordSchema>;
export type OrderRecord = z.infer<typeof orderRecordSchema>;
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;
export type OutboxItem = z.infer<typeof outboxItemSchema>;
export type LogKind = (typeof LOG_KINDS)[number];
export type LogEntry = z.infer<typeof logEntrySchema>;
export type ServerState = z.infer<typeof serverStateSchema>;

export const createInitialState = (presetId: ServerState["presetId"] = "happy"): ServerState => ({
  version: STATE_VERSION,
  presetId,
  sold: {},
  holds: {},
  orders: {},
  payments: {},
  idempotency: {},
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
