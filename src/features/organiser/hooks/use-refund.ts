import { useRef } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { OrderPageDto, OrganiserOrderDto } from "@/contract/dto";
import type { RefundReason } from "@/core/statuses";
import { NetworkError, problemOf } from "@/lib/api-client";
import { organiserApi } from "@/lib/organiser-api";
import { organiserQueries } from "@/lib/queries";

type OrderPages = InfiniteData<OrderPageDto, string | undefined>;

const mintIdempotencyKey = () => crypto.randomUUID();

/** Every cached page of the orders table, with one order's row changed. */
const withRow = (data: OrderPages | undefined, orderId: string, change: Partial<OrderPageDto["orders"][number]>) =>
  data && {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      orders: page.orders.map((row) => (row.id === orderId ? { ...row, ...change } : row)),
    })),
  };

/**
 * Refund an order, optimistically (TanStack Query, "Optimistic updates"): the order
 * and its row in every cached table page say "Refund pending" at once. If the request
 * fails, each goes back to what it was and the page says why. Either way, the order is
 * re-read afterwards, so the screen ends up with the server's word. The idempotency key
 * is kept for a retry after a lost connection, so a retry can't refund twice; a retry
 * with another reason is another request, with its own key (the server refuses a
 * second refund of the same order either way).
 */
export function useRefund(order: OrganiserOrderDto, { onFailed }: { onFailed: (message: string) => void }) {
  const queryClient = useQueryClient();
  const attempt = useRef<{ key: string; reason: RefundReason } | null>(null);
  const orderKey = organiserQueries.order(order.id).queryKey;
  const listsKey = organiserQueries.ordersAll();

  return useMutation({
    mutationFn: (reason: RefundReason) => {
      if (attempt.current?.reason !== reason) attempt.current = { key: mintIdempotencyKey(), reason };
      return organiserApi.requestRefund(order.id, reason, attempt.current.key);
    },
    onMutate: async () => {
      // Anything in flight would land on top of the optimistic state: stop it first.
      await queryClient.cancelQueries({ queryKey: orderKey });
      await queryClient.cancelQueries({ queryKey: listsKey });
      const previousOrder = queryClient.getQueryData(orderKey);
      const previousLists = queryClient.getQueriesData<OrderPages>({ queryKey: listsKey });
      queryClient.setQueryData(orderKey, (current) => current && { ...current, refundStatus: "pending" as const });
      queryClient.setQueriesData<OrderPages>({ queryKey: listsKey }, (data) =>
        withRow(data, order.id, { refundStatus: "pending" }),
      );
      return { previousOrder, previousLists };
    },
    onError: (error, ...[, snapshot]) => {
      queryClient.setQueryData(orderKey, snapshot?.previousOrder);
      for (const [key, data] of snapshot?.previousLists ?? []) queryClient.setQueryData(key, data);
      if (error instanceof NetworkError) {
        onFailed(
          "The connection dropped, so we can’t tell whether the refund started. Trying again is safe: it can’t refund twice.",
        );
        return;
      }
      attempt.current = null; // the server answered: a new attempt is a new request
      onFailed(problemOf(error)?.detail ?? "The refund couldn’t start.");
    },
    onSuccess: (result) => {
      attempt.current = null;
      queryClient.setQueryData(orderKey, result.order);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: orderKey });
    },
  });
}
