/**
 * The order lifecycle as an explicit state machine. Every status change goes through
 * `canTransition`, so an impossible jump (say, refunded → fulfilled) is a bug that
 * throws rather than a state the UI has to make sense of.
 *
 *   pending ──► paid ──► fulfilled
 *     │  ▲        └────► refunded     (payment landed after the hold expired)
 *     ▼  │
 *   failed         pending/failed ──► expired   (hold ran out before payment)
 */
import type { OrderStatus } from "@/core/statuses";

export const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "failed", "expired"],
  failed: ["pending", "expired"],
  paid: ["fulfilled", "refunded"],
  fulfilled: [],
  refunded: [],
  expired: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) => transitions[from].includes(to);

export const isTerminal = (status: OrderStatus) => transitions[status].length === 0;

export class IllegalTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Illegal order transition: ${from} → ${to}`);
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
