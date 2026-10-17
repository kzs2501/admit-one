import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Problem } from "@/contract/problems";
import type { CreateHoldRequest } from "@/contract/requests";
import { apiClient, problemOf } from "@/lib/api-client";
import { eventQueries, holdQueries, seatQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * Reserving, by tier or by seat: create a hold, seed the checkout's cache with it (so
 * the first step renders without another round-trip), and go. When the server answers
 * with a problem the buyer can act on — sold out, a seat taken — the caller hears about
 * it, and availability is refreshed, because it has evidently changed.
 */
export function useReserveHold(onProblem: (problem: Problem) => void) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const reserve = useMutation({
    mutationFn: (request: CreateHoldRequest) => apiClient.createHold(request),
    onSuccess: (details) => {
      queryClient.setQueryData(holdQueries.detail(details.hold.id).queryKey, details);
      router.push(routes.checkoutStep(details.hold.id, "attendees"));
    },
    onError: (error) => {
      const problem = problemOf(error);
      if (!problem) return;
      onProblem(problem);
      void queryClient.invalidateQueries({ queryKey: eventQueries.all() });
      void queryClient.invalidateQueries({ queryKey: seatQueries.all() });
    },
  });

  return {
    reserve: reserve.mutate,
    isReserving: reserve.isPending,
    /** The last failure, problem or not; callers decide what to say. */
    error: reserve.error,
  };
}
