import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderDto, PaymentResultDto } from "@/contract/dto";
import { apiClient, NetworkError, problemOf } from "@/lib/api-client";
import { holdQueries } from "@/lib/queries";
import { pendingUpiRequest } from "@/features/checkout/domain/payment-methods";

const mintIdempotencyKey = () => crypto.randomUUID();

/**
 * Paying by UPI: ask for a payment request, then wait while the buyer approves it in
 * their UPI app — or cancel it to pay another way. As with a card, the browser never
 * decides whether money moved: the checkout keeps re-reading the order (see
 * `useCheckout`), and once the payment is with the provider it hands over to the order
 * page, which waits for the webhook.
 */
export function useUpiPayment({
  holdId,
  order,
  onExpired,
}: {
  holdId: string;
  order: OrderDto;
  onExpired: () => void;
}) {
  const queryClient = useQueryClient();
  // One key per request for a payment: a retry after a lost response replays it.
  const attemptKey = useRef<string | null>(null);
  const holdKey = holdQueries.detail(holdId).queryKey;

  /**
   * The server's answer is the latest word on the order: show it straight away. It's
   * recorded at the time the rest of the details were fetched, because their
   * `serverTime` is from then — and every countdown corrects its clock by comparing the two.
   */
  const showOrder = ({ order: latest }: PaymentResultDto) => {
    const current = queryClient.getQueryState(holdKey);
    if (!current?.data) return;
    queryClient.setQueryData(holdKey, { ...current.data, order: latest }, { updatedAt: current.dataUpdatedAt });
  };
  const reread = () => queryClient.invalidateQueries({ queryKey: holdKey });

  const request = useMutation({
    mutationFn: () => {
      attemptKey.current ??= mintIdempotencyKey();
      return apiClient.createPayment(order.id, { method: "upi" }, attemptKey.current);
    },
    onSuccess: (result) => {
      attemptKey.current = null;
      showOrder(result);
    },
    onError: (error) => {
      switch (problemOf(error)?.code) {
        case "hold_expired":
          onExpired();
          break;
        case "payment_in_progress":
        case "already_completed":
          void reread();
          break;
        default:
          break; // a network failure keeps the key: asking again is a safe retry
      }
    },
  });

  const cancel = useMutation({
    mutationFn: (paymentId: string) => apiClient.cancelPayment(paymentId),
    onSuccess: showOrder,
    // Too late — the buyer approved — or already over: re-read, and the checkout follows.
    onError: () => void reread(),
  });

  const pending = pendingUpiRequest(order);
  return {
    pending,
    request: () => {
      request.mutate();
    },
    isRequesting: request.isPending,
    /** The answer was lost: the same key is kept, so asking again can't make a second request. */
    hasConnectionProblem: request.error instanceof NetworkError,
    cancel: () => {
      if (pending) cancel.mutate(pending.paymentId);
    },
    isCancelling: cancel.isPending,
  };
}
