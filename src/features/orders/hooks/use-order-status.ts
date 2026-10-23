import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrderDto } from "@/contract/dto";
import { isAwaitingConfirmation, isAwaitingPayment } from "@/core/order-status";
import { problemOf } from "@/lib/api-client";
import { orderQueries, shouldShowQueryError } from "@/lib/queries";

/** After this long waiting for the webhook, reassure the buyer. */
const SLOW_CONFIRMATION_MS = 8_000;

const POLL_FIRST_MS = 500;
const POLL_MAX_MS = 4_000;

/** 0.5s, 1s, 2s, then every 4s: fast when it's likely to finish, gentle when it isn't. */
export const pollDelayMs = (attempt: number) => Math.min(POLL_MAX_MS, POLL_FIRST_MS * 2 ** attempt);

/**
 * When to look again: while the order waits to be confirmed, sooner then gentler; never
 * once it's settled, or when there's no such order (nothing will change); and backing
 * off while the server can't be read.
 */
export function orderPollDelayMs(
  order: OrderDto | undefined,
  error: unknown,
  { dataUpdateCount, errorUpdateCount }: { dataUpdateCount: number; errorUpdateCount: number },
): number | false {
  if (order) return isAwaitingConfirmation(order) ? pollDelayMs(dataUpdateCount) : false;
  if (problemOf(error)?.code === "not_found") return false;
  return pollDelayMs(error ? errorUpdateCount : 0);
}

/** Everything the order page can be showing — exactly one at a time. */
export type OrderPageState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "load-error" }
  | { kind: "awaiting-payment"; order: OrderDto }
  | { kind: "confirming"; order: OrderDto; isSlow: boolean }
  | { kind: "fulfilled" | "refunded" | "expired" | "failed"; order: OrderDto };

export function toOrderPageState(order: OrderDto, isSlow: boolean): OrderPageState {
  if (isAwaitingPayment(order)) return { kind: "awaiting-payment", order };
  if (isAwaitingConfirmation(order)) return { kind: "confirming", order, isSlow };
  switch (order.status) {
    case "fulfilled":
    case "refunded":
    case "expired":
    case "failed":
      return { kind: order.status, order };
    case "pending":
    case "paid":
      // Covered by the two checks above; kept so the switch stays exhaustive.
      return { kind: "confirming", order, isSlow };
  }
}

/**
 * The order page's view-model. The browser lands here after paying, and never assumes
 * the payment worked just because it got here: it polls until the webhook has settled
 * the order, however long that takes, and whichever arrived first.
 */
export function useOrderStatus(orderId: string): OrderPageState {
  const [isSlow, setIsSlow] = useState(false);
  const query = useQuery({
    ...orderQueries.detail(orderId),
    refetchInterval: ({ state }) => orderPollDelayMs(state.data, state.error, state),
  });

  const isConfirming = query.data ? isAwaitingConfirmation(query.data) : false;
  // Reassure after a while; the clock starts when the waiting does.
  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      setIsSlow(true);
    }, SLOW_CONFIRMATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isConfirming]);

  return deriveOrderPageState(query.data, query.error, isSlow);
}

/** What the page shows for the latest query result — a failed refresh doesn't wipe a known order. */
export function deriveOrderPageState(order: OrderDto | undefined, error: unknown, isSlow: boolean): OrderPageState {
  if (shouldShowQueryError(order, error)) {
    return { kind: problemOf(error)?.code === "not_found" ? "not-found" : "load-error" };
  }
  if (!order) return { kind: "loading" };
  return toOrderPageState(order, isSlow);
}
