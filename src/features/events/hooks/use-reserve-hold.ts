import { useCallback, useState, useTransition } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Problem } from "@/contract/problems";
import type { CreateHoldRequest } from "@/contract/requests";
import { ApiError, apiClient, problemOf } from "@/lib/api-client";
import { eventQueries, holdQueries, queueQueries, seatQueries } from "@/lib/queries";
import { readQueueToken } from "@/lib/queue-token";
import { routes } from "@/lib/routes";

/**
 * Reserving, by tier or by seat: create a hold, seed the checkout's cache with it (so
 * the first step renders without another round-trip), and go. When the server answers
 * with a problem the buyer can act on — sold out, a seat taken — the caller hears about
 * it, and availability is refreshed, because it has evidently changed.
 *
 * A 429 is handled here, once, for every caller: reserving is off until the moment the
 * server named, and `retryAtMs` lets the page count down to it.
 */
export function useReserveHold(onProblem: (problem: Problem) => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retryAtMs, setRetryAtMs] = useState<number | null>(null);
  // Going to the checkout is a transition: the buttons stay busy until it's there, so a
  // second press in between can't take a second hold.
  const [isNavigating, startNavigating] = useTransition();

  const reserve = useMutation({
    // In a sale with a waiting room, your place in its queue goes with the request.
    mutationFn: (request: CreateHoldRequest) => apiClient.createHold(request, readQueueToken(request.eventSlug)),
    onSuccess: (details) => {
      queryClient.setQueryData(holdQueries.detail(details.hold.id).queryKey, details);
      startNavigating(() => {
        router.push(routes.checkoutStep(details.hold.id, "attendees"));
      });
    },
    onError: (error) => {
      const problem = problemOf(error);
      if (!problem) return;
      if (problem.code === "rate_limited") {
        // The header is the standard way to say it; the problem body says the same.
        const waitMs =
          error instanceof ApiError && error.retryAfterMs !== null
            ? error.retryAfterMs
            : problem.retryAfterSeconds * 1000;
        setRetryAtMs(Date.now() + waitMs);
        return;
      }
      onProblem(problem);
      void queryClient.invalidateQueries({ queryKey: eventQueries.all() });
      void queryClient.invalidateQueries({ queryKey: seatQueries.all() });
      void queryClient.invalidateQueries({ queryKey: queueQueries.all() });
    },
  });

  const onRetryReady = useCallback(() => {
    setRetryAtMs(null);
  }, []);

  return {
    reserve: (request: CreateHoldRequest) => {
      if (retryAtMs === null && !reserve.isPending && !isNavigating) reserve.mutate(request);
    },
    isReserving: reserve.isPending || isNavigating,
    /** The last failure, problem or not, except a rate limit (that's `retryAtMs`). */
    error: problemOf(reserve.error)?.code === "rate_limited" ? null : reserve.error,
    /** Forget the last failure, once the buyer has moved on from it. */
    clearError: reserve.reset,
    /** When reserving may be tried again, after a 429; null when it may now. */
    retryAtMs,
    onRetryReady,
  };
}
