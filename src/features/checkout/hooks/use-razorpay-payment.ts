import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderDto, PaymentResultDto } from "@/contract/dto";
import { apiClient, NetworkError, problemOf } from "@/lib/api-client";
import { holdQueries } from "@/lib/queries";
import { loadRazorpayCheckout, type RazorpayCheckoutResult } from "@/lib/razorpay-checkout";
import { pendingRazorpayCheckout, type PendingRazorpayCheckout } from "@/features/checkout/domain/payment-methods";

const mintIdempotencyKey = () => crypto.randomUUID();

/** The brand's accent, as Checkout takes it: a hex colour, where the site's tokens are OKLCH. */
const CHECKOUT_COLOUR = "#be4400";

/** What went wrong, for the buyer: Checkout couldn't load, or the server couldn't yet confirm a payment. */
export type RazorpayProblem = "blocked" | "unconfirmed" | null;

/**
 * Paying through Razorpay's checkout: ask the server for one, then open Razorpay's page
 * over this one. When the buyer pays there, Checkout's signed result goes to the server,
 * which asks Razorpay what was paid; the checkout keeps re-reading the order meanwhile
 * (see `useCheckout`), and moves to the order page once it's settled. Closing Checkout
 * cancels the payment, so the choice of what to do next comes back.
 */
export function useRazorpayPayment({
  holdId,
  order,
  onExpired,
}: {
  holdId: string;
  order: OrderDto;
  onExpired: () => void;
}) {
  const queryClient = useQueryClient();
  // One key per request for a checkout: a retry after a lost response replays it.
  const attemptKey = useRef<string | null>(null);
  const holdKey = holdQueries.detail(holdId).queryKey;
  const [problem, setProblem] = useState<RazorpayProblem>(null);
  const [isOpening, setIsOpening] = useState(false);

  /** The server's answer is the latest word on the order: show it at once, timed as the details were (see `useUpiPayment`). */
  const showOrder = ({ order: latest }: PaymentResultDto) => {
    const current = queryClient.getQueryState(holdKey);
    if (!current?.data) return;
    queryClient.setQueryData(holdKey, { ...current.data, order: latest }, { updatedAt: current.dataUpdatedAt });
  };
  const reread = () => queryClient.invalidateQueries({ queryKey: holdKey });

  const confirm = useMutation({
    mutationFn: ({ paymentId, result }: { paymentId: string; result: RazorpayCheckoutResult }) =>
      apiClient.confirmRazorpayPayment(paymentId, {
        razorpayOrderId: result.razorpay_order_id,
        razorpayPaymentId: result.razorpay_payment_id,
        razorpaySignature: result.razorpay_signature,
      }),
    onSuccess: showOrder,
    // Razorpay's webhook settles it anyway; meanwhile the checkout keeps looking.
    onError: () => {
      setProblem("unconfirmed");
      void reread();
    },
  });

  const cancel = useMutation({
    mutationFn: (paymentId: string) => apiClient.cancelPayment(paymentId),
    onSuccess: showOrder,
    onError: () => void reread(),
  });

  async function open(checkout: PendingRazorpayCheckout) {
    setIsOpening(true);
    let Checkout;
    try {
      Checkout = await loadRazorpayCheckout();
    } catch {
      setProblem("blocked");
      return;
    } finally {
      setIsOpening(false);
    }
    setProblem(null);
    let hasPaid = false;
    const attendee = order.attendees[0];
    new Checkout({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountMinor,
      currency: checkout.currency,
      name: "admit-one",
      description: `Order ${order.id}`,
      timeout: Math.max(1, Math.floor((Date.parse(checkout.expiresAt) - Date.now()) / 1000)),
      prefill: { name: attendee?.name ?? "", email: attendee?.email ?? "" },
      theme: { color: CHECKOUT_COLOUR },
      handler: (result) => {
        hasPaid = true;
        confirm.mutate({ paymentId: checkout.paymentId, result });
      },
      modal: {
        ondismiss: () => {
          if (!hasPaid) cancel.mutate(checkout.paymentId);
        },
      },
    }).open();
  }

  const request = useMutation({
    mutationFn: () => {
      attemptKey.current ??= mintIdempotencyKey();
      return apiClient.createPayment(order.id, { method: "razorpay" }, attemptKey.current);
    },
    onSuccess: (result) => {
      attemptKey.current = null;
      showOrder(result);
      const checkout = pendingRazorpayCheckout(result.order);
      if (checkout) void open(checkout);
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

  const pending = pendingRazorpayCheckout(order);
  return {
    pending,
    /** Open the checkout that's waiting, or ask for one. */
    pay: () => {
      if (pending) void open(pending);
      else request.mutate();
    },
    isStarting: request.isPending || isOpening,
    isConfirming: confirm.isPending,
    problem,
    /** The answer was lost: the same key is kept, so asking again can't open a second checkout. */
    hasConnectionProblem: request.error instanceof NetworkError,
    /** A problem the server put into words: Razorpay unreachable, the order changed. */
    requestProblem: request.error instanceof NetworkError ? null : (problemOf(request.error)?.detail ?? null),
    cancel: () => {
      if (pending) cancel.mutate(pending.paymentId);
    },
    isCancelling: cancel.isPending,
  };
}
