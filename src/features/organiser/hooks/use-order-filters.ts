import { useCallback, useMemo, useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OrderFilters } from "@/contract/queries";
import { routes } from "@/lib/routes";
import { filtersFromSearchParams, filtersToSearchParams } from "@/features/organiser/domain/order-filters";

/**
 * The orders table's filters, read from the URL and written back to it. Choosing a
 * filter is a step Back can undo, so it pushes; typing a search replaces, so Back
 * doesn't walk through every keystroke.
 *
 * Next changes the URL in a transition, so a control bound to it would snap back
 * until the navigation finished. The filters are optimistic instead (React's
 * `useOptimistic`): they change at once, and the URL catches up.
 */
export function useOrderFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fromUrl = useMemo(() => filtersFromSearchParams(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [filters, setOptimisticFilters] = useOptimistic(fromUrl);
  const [, startTransition] = useTransition();

  const setFilters = useCallback(
    (patch: Partial<OrderFilters>, { isTyping = false } = {}) => {
      const next = { ...filters, ...patch };
      const href = routes.organiserOrders(filtersToSearchParams(next));
      startTransition(() => {
        setOptimisticFilters(next);
        if (isTyping) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [filters, router, setOptimisticFilters],
  );

  return { filters, setFilters };
}
