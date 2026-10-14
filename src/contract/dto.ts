/**
 * The HTTP contract between the app and the server. The app only ever sees these
 * shapes — it can't tell the server is simulated in the browser.
 */
import type { AddOn, EventInfo, Tier } from "@/core/catalog";

export type TierAvailability = Tier & { available: number };

export type EventView = Omit<EventInfo, "tiers"> & { tiers: TierAvailability[] };

export type LineItem = { tierId: string; qty: number };

export type HoldStatus = "active" | "expired" | "converted";

export type HoldView = {
  id: string;
  eventSlug: string;
  items: LineItem[];
  createdAt: number;
  expiresAt: number;
  status: HoldStatus;
  orderId: string | null;
};

export type Attendee = { name: string; email: string };

export type OrderStatus = "pending" | "paid" | "fulfilled" | "failed" | "expired" | "refunded";

export type Amounts = {
  ticketsCents: number;
  addOnsCents: number;
  feesCents: number;
  totalCents: number;
};

export type Ticket = { code: string; attendeeName: string; tierName: string };

export type PaymentStatus = "processing" | "requires_action" | "succeeded" | "failed" | "refunded";

export type PaymentView = {
  id: string;
  status: PaymentStatus;
  last4: string;
  failureCode: string | null;
};

export type OrderView = {
  id: string;
  holdId: string;
  eventSlug: string;
  items: LineItem[];
  attendees: Attendee[];
  addOns: Record<string, number>;
  amounts: Amounts;
  status: OrderStatus;
  /** Why an order ended up refunded or expired, in plain words. */
  statusReason: string | null;
  tickets: Ticket[];
  payment: PaymentView | null;
  createdAt: number;
  updatedAt: number;
};

/** Returned with holds so the client can correct for clock skew. */
export type WithServerTime<T> = T & { serverNow: number };

export type HoldResponse = WithServerTime<{ hold: HoldView; event: EventView; order: OrderView | null }>;

export type ApiErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export type { AddOn, EventInfo, Tier };
