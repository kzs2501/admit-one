import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrderDto } from "@/contract/dto";
import { isAwaitingConfirmation, isAwaitingPayment } from "@/core/order-status";
import { problemOf } from "@/lib/api-client";
import { orderQueries } from "@/lib/queries";

/** After this long waiting for the webhook, reassure the buyer. */
const SLOW_CONFIRMATION_MS = 8_000;

const POLL_FIRST_MS = 500;
const POLL_MAX_MS = 4_000;

/** 0.5s, 1s, 2s, then every 4s: fast when it's likely to finish, gentle when it isn't. */
export const pollDelayMs = (attempt: number) => Math.min(POLL_MAX_MS, POLL_FIRST_MS * 2 ** attempt);

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
    refetchInterval: (current) =>
      current.state.data && !isAwaitingConfirmation(current.state.data)
        ? false
        : pollDelayMs(current.state.dataUpdateCount),
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

  if (query.isError) return { kind: problemOf(query.error)?.code === "not_found" ? "not-found" : "load-error" };
  if (!query.data) return { kind: "loading" };
  return toOrderPageState(query.data, isSlow);
}
