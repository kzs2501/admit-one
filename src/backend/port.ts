/**
 * What the HTTP adapter needs from a backend: the port between the API's handlers and
 * whatever keeps the data. The in-browser sandbox implements all of it; the server
 * backend (Postgres) implements the buyer's part. Each method has the sandbox's own
 * signature, except that a server may answer later, with a promise.
 */
import type { Backend } from "./backend";
import type { Awaitable, IdempotencyStore } from "./idempotency-store";

export type { Awaitable, IdempotencyClaim, IdempotencyStore } from "./idempotency-store";

/** The same function, allowed to answer with a promise. */
type MayAwait<F> = F extends (...args: infer A) => infer R ? (...args: A) => Awaitable<R> : never;

/** What every handler uses: the chaos settings (for latency), the server log, and idempotency. */
export interface KitPort {
  chaos: Backend["chaos"];
  log: Backend["log"];
  idempotency: IdempotencyStore;
}

/** The buyer's API: events, seats, holds, orders and payments. */
export const BUYER_METHODS = [
  "listEvents",
  "getEvent",
  "getSeatAvailability",
  "createHold",
  "getHold",
  "upsertOrder",
  "getOrder",
  "createPayment",
  "confirmChallenge",
  "cancelPayment",
] as const;

export type BuyerPort = KitPort & { [Method in (typeof BUYER_METHODS)[number]]: MayAwait<Backend[Method]> };
