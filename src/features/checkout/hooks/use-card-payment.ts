import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderDto, PaymentResultDto } from "@/contract/dto";
import type { ConfirmChallengeRequest } from "@/contract/requests";
import type { CardInput } from "@/core/schemas";
import { apiClient, NetworkError, problemOf } from "@/lib/api-client";
import { holdQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { attemptFor, type Attempt } from "@/features/checkout/domain/payment-attempt";

const mintIdempotencyKey = () => crypto.randomUUID();

/**
 * Paying by card: one payment attempt at a time, each with its own idempotency key;
 * the bank's 3-D Secure challenge; and what each answer means for the buyer. The response to "pay" is never treated as proof of payment — on success
 * the buyer goes to the order page, which waits for the provider's webhook.
 */
export function useCardPayment({
  order,
  onExpired,
  onDeclined,
  onInvalidCard,
  onRefused,
}: {
  order: OrderDto;
  onExpired: () => void;
  /** The bank said no: the attempt is over, and a retry is a new attempt. */
  onDeclined: (message: string) => void;
  onInvalidCard: (message: string) => void;
  /** The server turned the payment away for another reason; nothing was charged. */
  onRefused: (message: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const attempt = useRef<Attempt | null>(null);
  // A refresh in the middle of 3-D Secure brings the challenge straight back.
  const [challengePaymentId, setChallengePaymentId] = useState<string | null>(() =>
    order.payment?.nextAction?.type === "card_challenge" ? order.payment.id : null,
  );

  const goToOrder = () => {
    router.push(routes.order(order.id));
  };

  const endAttempt = (message: string) => {
    attempt.current = null;
    onDeclined(message);
  };

  const handleResult = (result: PaymentResultDto) => {
    if (result.payment.nextAction?.type === "card_challenge") {
      setChallengePaymentId(result.payment.id);
      // Starting a payment extended the hold on the server: the countdown should show it.
      void queryClient.invalidateQueries({ queryKey: holdQueries.detail(order.holdId).queryKey });
    } else {
      goToOrder();
    }
  };

  const pay = useMutation({
    mutationFn: (card: CardInput) => {
      attempt.current = attemptFor(attempt.current, card, mintIdempotencyKey);
      return apiClient.createPayment(order.id, { method: "card", ...card }, attempt.current.key);
    },
    onSuccess: handleResult,
    onError: (error) => {
      const problem = problemOf(error);
      // No problem at all: the answer was lost. The attempt is kept, so retrying is safe
      // (see `hasConnectionProblem`); so is a key still in use by the first request.
      if (!problem || problem.code === "idempotency_key_in_use") return;
      switch (problem.code) {
        case "card_declined":
        case "authentication_failed":
          endAttempt(problem.detail);
          return;
        case "hold_expired":
          onExpired();
          return;
        case "payment_in_progress":
        case "already_completed":
          goToOrder();
          return;
        case "invalid_card":
          onInvalidCard(problem.detail);
          return;
        default:
          // Anything else (too many tries, an order that's moved on, a key reused): it's
          // said, and the next try is a new attempt.
          attempt.current = null;
          onRefused(problem.detail);
      }
    },
  });

  const authenticate = useMutation({
    mutationFn: (decision: ConfirmChallengeRequest["decision"]) => {
      if (!challengePaymentId) throw new Error("No payment is waiting for authentication.");
      return apiClient.confirmChallenge(challengePaymentId, { decision });
    },
    onSuccess: (result) => {
      setChallengePaymentId(null);
      handleResult(result);
    },
    onError: (error) => {
      const problem = problemOf(error);
      // The bank's answer is final; a lost connection isn't, so the challenge stays, to try again.
      if (problem?.code === "authentication_failed") {
        setChallengePaymentId(null);
        endAttempt(problem.detail);
      } else if (problem) {
        setChallengePaymentId(null);
      }
    },
  });

  return {
    pay: pay.mutate,
    isPaying: pay.isPending,
    /**
     * The outcome is unknown, so the same attempt — and key — is kept for a safe retry:
     * the answer was lost, or the first request with the key is still being handled.
     */
    hasConnectionProblem: pay.error instanceof NetworkError || problemOf(pay.error)?.code === "idempotency_key_in_use",
    challengePaymentId,
    authenticate: authenticate.mutate,
    isAuthenticating: authenticate.isPending,
    /** Answering the challenge didn't reach the bank: the dialog says so, and stays. */
    hasChallengeConnectionProblem: authenticate.error instanceof NetworkError,
    /**
     * The dialog was closed without an answer (the browser lets a second Escape through).
     * The payment still waits, so paying again brings the same challenge back.
     */
    dismissChallenge: () => {
      setChallengePaymentId(null);
    },
  };
}
