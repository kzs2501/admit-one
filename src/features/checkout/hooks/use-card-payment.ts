import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { OrderDto, PaymentResultDto } from "@/contract/dto";
import type { ConfirmChallengeRequest } from "@/contract/requests";
import type { CardInput } from "@/core/schemas";
import { apiClient, NetworkError, problemOf } from "@/lib/api-client";
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
}: {
  order: OrderDto;
  onExpired: () => void;
  /** The bank said no: the attempt is over, and a retry is a new attempt. */
  onDeclined: (message: string) => void;
  onInvalidCard: (message: string) => void;
}) {
  const router = useRouter();
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
    if (result.payment.nextAction?.type === "card_challenge") setChallengePaymentId(result.payment.id);
    else goToOrder();
  };

  const pay = useMutation({
    mutationFn: (card: CardInput) => {
      attempt.current = attemptFor(attempt.current, card.number, mintIdempotencyKey);
      return apiClient.createPayment(order.id, { method: "card", ...card }, attempt.current.key);
    },
    onSuccess: handleResult,
    onError: (error) => {
      const problem = problemOf(error);
      switch (problem?.code) {
        case "card_declined":
        case "authentication_failed":
          endAttempt(problem.detail);
          break;
        case "hold_expired":
          onExpired();
          break;
        case "payment_in_progress":
        case "already_completed":
          goToOrder();
          break;
        case "invalid_card":
          onInvalidCard(problem.detail);
          break;
        default:
          break; // a network failure keeps the attempt: retrying is safe (see `hasConnectionProblem`)
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
      setChallengePaymentId(null);
      const problem = problemOf(error);
      if (problem?.code === "authentication_failed") endAttempt(problem.detail);
    },
  });

  return {
    pay: pay.mutate,
    isPaying: pay.isPending,
    /** The outcome is unknown, so the same attempt — and key — is kept for a safe retry. */
    hasConnectionProblem: pay.error instanceof NetworkError,
    challengePaymentId,
    authenticate: authenticate.mutate,
    isAuthenticating: authenticate.isPending,
  };
}
