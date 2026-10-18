import { useState } from "react";
import { useReserveHold } from "./use-reserve-hold";

/**
 * Reserving by tier ("two Premium"). When someone else got there first, trim the
 * selection to what's left and say so. For an event with reserved seating, the server
 * chooses the best seats available.
 */
export function useReserveTickets(slug: string) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [soldOutNotice, setSoldOutNotice] = useState<string | null>(null);

  const hold = useReserveHold((problem) => {
    if (problem.code !== "sold_out") return;
    const { tierId, available } = problem;
    setQuantities((current) => ({ ...current, [tierId]: Math.min(current[tierId] ?? 0, available) }));
    setSoldOutNotice(
      available === 0
        ? "Someone just got the last of those tickets."
        : `Someone got there first — only ${available} left now.`,
    );
  });

  return {
    quantities,
    setQuantity: (tierId: string, quantity: number) => {
      setQuantities((current) => ({ ...current, [tierId]: quantity }));
    },
    soldOutNotice,
    reserve: () => {
      setSoldOutNotice(null);
      hold.reserve({
        eventSlug: slug,
        items: Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([tierId, quantity]) => ({ tierId, quantity })),
      });
    },
    isReserving: hold.isReserving,
    /** Any other failure, for a generic notice. */
    reserveError: hold.error && !soldOutNotice ? hold.error : null,
    retryAtMs: hold.retryAtMs,
    onRetryReady: hold.onRetryReady,
  };
}
