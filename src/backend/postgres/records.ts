/**
 * Rows as the sandbox's records, and back. The server backend loads one hold's rows
 * into the sandbox's own shapes and runs the sandbox's rules on them (see
 * `unit-of-work.ts`), so both backends keep the same rules and show the same views.
 */
import { DEFAULT_CHAOS, type ChaosConfig } from "@/backend/chaos/presets";
import type { BackendContext, Deps } from "@/backend/domain/context";
import {
  createInitialState,
  type HoldRecord,
  type OrderRecord,
  type OutboxItem,
  type PaymentRecord,
} from "@/backend/domain/state";
import type { PaymentFailureCode, PaymentMethod, PaymentStatus } from "@/core/statuses";
import type { holds, orders, payments, providerEvents } from "./schema";

/**
 * The server's settings, where the sandbox has chaos presets: no simulated latency, and
 * the sandbox's usual limit on reserving, counted per client in Postgres. The
 * simulated provider still takes a moment to send its webhook, as real ones do.
 */
export const SERVER_SETTINGS: ChaosConfig = {
  ...DEFAULT_CHAOS,
  latencyRangeMs: [0, 0],
  extraPaymentLatencyMs: 0,
};

export type ServerDeps = Omit<Deps, "newToken"> & {
  /**
   * The ways to pay that the server's provider takes. The simulated provider takes cards
   * only: UPI is approved in the buyer's own app, which only a real provider can reach.
   */
  paymentMethods?: readonly PaymentMethod[];
  /** Razorpay's public key, when Razorpay is the provider. */
  razorpayKeyId?: string | null;
};

const SIMULATED_PROVIDER_METHODS: readonly PaymentMethod[] = ["card"];

const msOf = (date: Date) => date.getTime();

export const holdRecordOf = (row: typeof holds.$inferSelect): HoldRecord => ({
  id: row.id,
  eventSlug: row.eventSlug,
  items: row.items,
  seatIds: row.seatIds,
  createdAtMs: msOf(row.createdAt),
  expiresAtMs: msOf(row.expiresAt),
  isConverted: row.status === "converted",
  isExtended: row.isExtended,
  orderId: row.orderId,
});

export const orderRecordOf = (row: typeof orders.$inferSelect): OrderRecord => ({
  id: row.id,
  holdId: row.holdId,
  eventSlug: row.eventSlug,
  items: row.items,
  attendees: row.attendees,
  addOns: row.addOns,
  amounts: row.amounts,
  status: row.status,
  statusReason: row.statusReason,
  tickets: row.tickets,
  paymentId: row.paymentId,
  createdAtMs: msOf(row.createdAt),
  updatedAtMs: msOf(row.updatedAt),
});

export const orderRowOf = (record: OrderRecord): typeof orders.$inferInsert => ({
  ...record,
  createdAt: new Date(record.createdAtMs),
  updatedAt: new Date(record.updatedAtMs),
});

export function paymentRecordOf(row: typeof payments.$inferSelect): PaymentRecord {
  const base = {
    id: row.id,
    orderId: row.orderId,
    amountMinor: row.amountMinor,
    status: row.status as PaymentStatus,
    failureCode: row.failureCode as PaymentFailureCode | null,
    webhookLagMs: row.webhookLagMs,
    createdAtMs: msOf(row.createdAt),
  };
  switch (row.method) {
    case "upi":
      return { ...base, method: "upi", expiresAtMs: msOf(row.upiExpiresAt ?? row.createdAt) };
    case "razorpay":
      return {
        ...base,
        method: "razorpay",
        providerOrderId: row.providerOrderId ?? "",
        providerPaymentId: row.providerPaymentId,
        instrument: row.instrument,
        last4: row.last4,
        expiresAtMs: msOf(row.checkoutExpiresAt ?? row.createdAt),
      };
    case "card":
      return { ...base, method: "card", last4: row.last4 ?? "" };
  }
}

export const paymentRowOf = (record: PaymentRecord): typeof payments.$inferInsert => ({
  id: record.id,
  orderId: record.orderId,
  method: record.method,
  amountMinor: record.amountMinor,
  status: record.status,
  failureCode: record.failureCode,
  last4: record.method === "upi" ? null : record.last4,
  upiExpiresAt: record.method === "upi" ? new Date(record.expiresAtMs) : null,
  providerOrderId: record.method === "razorpay" ? record.providerOrderId : null,
  providerPaymentId: record.method === "razorpay" ? record.providerPaymentId : null,
  instrument: record.method === "razorpay" ? record.instrument : null,
  checkoutExpiresAt: record.method === "razorpay" ? new Date(record.expiresAtMs) : null,
  webhookLagMs: record.webhookLagMs,
  createdAt: new Date(record.createdAtMs),
});

/** A payment event the sandbox's rules put in the outbox, as the simulated provider's row. */
export function providerEventRowOf(item: OutboxItem): typeof providerEvents.$inferInsert {
  const common = {
    deliveryId: item.deliveryId,
    eventId: item.eventId,
    type: item.type,
    enqueuedAt: new Date(item.enqueuedAtMs),
    deliverAt: new Date(item.deliverAtMs),
  };
  switch (item.type) {
    case "payment.succeeded":
      return { ...common, paymentId: item.paymentId };
    case "payment.failed":
      return { ...common, paymentId: item.paymentId, failureCode: item.failureCode };
    case "refund.succeeded":
      throw new Error("Refunds are the sandbox's alone.");
  }
}

export interface HoldRecords {
  hold: HoldRecord;
  orders: OrderRecord[];
  payments: PaymentRecord[];
  /** Swept: run out, and its tickets given back by a later hold's sweep (`stock.ts`). */
  isSwept?: boolean;
}

/** The sandbox's context, holding only the given records: enough for its rules and views to run on. */
export function contextWith(
  { paymentMethods = SIMULATED_PROVIDER_METHODS, razorpayKeyId = null, ...deps }: ServerDeps,
  records: Partial<HoldRecords> = {},
): BackendContext {
  const state = createInitialState("happy", deps.now());
  if (records.hold) state.holds[records.hold.id] = records.hold;
  for (const order of records.orders ?? []) state.orders[order.id] = order;
  for (const payment of records.payments ?? []) state.payments[payment.id] = payment;
  return {
    state,
    paymentMethods,
    razorpayKeyId,
    deps: {
      ...deps,
      newToken: () => {
        throw new Error("The server backend issues no session tokens.");
      },
    },
    chaos: () => SERVER_SETTINGS,
    log: () => undefined,
    // A hold here keeps its tickets, counted as held, until a sweep gives them back,
    // whatever this process's clock says: so it has them exactly while it's unswept.
    hasItsTickets: (hold) => hold.id === records.hold?.id && !hold.isConverted && records.isSwept !== true,
  };
}
