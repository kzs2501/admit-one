/**
 * The simulated server's entire state. It's plain JSON so it can be persisted
 * (sessionStorage in the browser) and restored after a reload — including webhooks
 * that were still waiting to be delivered.
 */
import type { Amounts, Attendee, LineItem, OrderStatus, PaymentStatus, Ticket } from "@/shared/api-types";
import type { PresetId } from "./chaos";

export type HoldRecord = {
  id: string;
  eventSlug: string;
  items: LineItem[];
  createdAt: number;
  expiresAt: number;
  converted: boolean;
  /** Payment start may extend a hold once, so a buyer mid-payment isn't cut off. */
  extended: boolean;
  orderId: string | null;
};

export type OrderRecord = {
  id: string;
  holdId: string;
  eventSlug: string;
  items: LineItem[];
  attendees: Attendee[];
  addOns: Record<string, number>;
  amounts: Amounts;
  status: OrderStatus;
  statusReason: string | null;
  tickets: Ticket[];
  paymentId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PaymentRecord = {
  id: string;
  orderId: string;
  amountCents: number;
  status: PaymentStatus;
  last4: string;
  failureCode: string | null;
  createdAt: number;
};

/** A stored response, replayed verbatim when the same Idempotency-Key comes back. */
export type IdempotencyRecord = {
  fingerprint: string;
  status: number;
  body: unknown;
};

/** A webhook waiting to be delivered: the outbox pattern. */
export type OutboxItem = {
  deliveryId: string;
  eventId: string;
  type: "payment.succeeded";
  paymentId: string;
  deliverAt: number;
};

export type LogKind = "request" | "hold" | "order" | "payment" | "webhook" | "crowd" | "warn";
export type LogEntry = { id: number; at: number; kind: LogKind; message: string };

export type ServerState = {
  version: 1;
  presetId: PresetId;
  /** Tickets sold in this sandbox, per tier (on top of each tier's baseline). */
  sold: Record<string, number>;
  holds: Record<string, HoldRecord>;
  orders: Record<string, OrderRecord>;
  payments: Record<string, PaymentRecord>;
  idempotency: Record<string, IdempotencyRecord>;
  /** Webhook event ids already processed — the dedupe set. */
  processedEvents: string[];
  outbox: OutboxItem[];
  log: LogEntry[];
  logSeq: number;
};

export const initialState = (presetId: PresetId = "happy"): ServerState => ({
  version: 1,
  presetId,
  sold: {},
  holds: {},
  orders: {},
  payments: {},
  idempotency: {},
  processedEvents: [],
  outbox: [],
  log: [],
  logSeq: 0,
});

export const serialize = (state: ServerState) => JSON.stringify(state);

/** Restore persisted state; anything unreadable starts a fresh sandbox. */
export function deserialize(raw: string | null): ServerState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServerState;
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}
