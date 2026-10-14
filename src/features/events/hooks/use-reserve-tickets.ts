import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, problemOf } from "@/lib/api-client";
import { eventQueries, holdQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * Reserving tickets: create a hold, seed the checkout's cache with it (so the first
 * step renders without another round-trip), and go. When someone else got there
 * first, trim the selection to what's left and say so.
 */
export function useReserveTickets(slug: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [soldOutNotice, setSoldOutNotice] = useState<string | null>(null);

  const reserve = useMutation({
    mutationFn: () =>
      apiClient.createHold({
        eventSlug: slug,
        items: Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([tierId, quantity]) => ({ tierId, quantity })),
      }),
    onSuccess: (details) => {
      queryClient.setQueryData(holdQueries.detail(details.hold.id).queryKey, details);
      router.push(routes.checkoutStep(details.hold.id, "attendees"));
    },
    onError: (error) => {
      const problem = problemOf(error);
      if (problem?.code !== "sold_out") return;
      const { tierId, available } = problem;
      setQuantities((current) => ({ ...current, [tierId]: Math.min(current[tierId] ?? 0, available) }));
      setSoldOutNotice(
        available === 0
          ? "Someone just got the last of those tickets."
          : `Someone got there first — only ${available} left now.`,
      );
      void queryClient.invalidateQueries({ queryKey: eventQueries.all() });
    },
  });

  return {
    quantities,
    setQuantity: (tierId: string, quantity: number) => {
      setQuantities((current) => ({ ...current, [tierId]: quantity }));
    },
    soldOutNotice,
    reserve: () => {
      setSoldOutNotice(null);
      reserve.mutate();
    },
    isReserving: reserve.isPending,
    /** Any other failure, for a generic notice. */
    reserveError: reserve.isError && !soldOutNotice ? reserve.error : null,
  };
}
