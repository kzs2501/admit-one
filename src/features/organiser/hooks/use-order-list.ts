import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderRowDto } from "@/contract/dto";
import type { OrderFilters } from "@/contract/queries";
import { organiserQueries } from "@/lib/queries";
import { filtersToSearchParams } from "@/features/organiser/domain/order-filters";
import { useLiveUpdates } from "./use-live-updates";

const NO_ROWS: readonly OrderRowDto[] = [];

/**
 * The orders that match the filters, a page at a time as the table scrolls. New orders
 * that arrive while it's open don't move the rows under the reader: the table notes
 * how far the live changes had got when it loaded, and offers to show newer ones.
 */
export function useOrderList(filters: OrderFilters) {
  const queryClient = useQueryClient();
  const options = organiserQueries.orders(filters);
  const query = useInfiniteQuery({ ...options, placeholderData: keepPreviousData });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.orders) ?? NO_ROWS, [query.data]);

  const { changes } = useLiveUpdates();
  const key = filtersToSearchParams(filters).toString();
  const [seen, setSeen] = useState({ key, version: changes.latest });
  // A new set of filters loads fresh rows, so it starts from what's known now.
  if (seen.key !== key) setSeen({ key, version: changes.latest });
  const lastChange = filters.event ? (changes.byEvent[filters.event] ?? 0) : changes.latest;

  return {
    rows,
    totalSize: query.data?.pages[0]?.totalSize ?? 0,
    isLoading: query.isPending,
    /** The last filters' rows, shown while the new ones load: their count isn't the answer yet. */
    isUpdating: query.isPlaceholderData,
    isError: query.isError && !query.data,
    retry: () => void query.refetch(),
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
    hasNewOrders: lastChange > seen.version,
    showNewOrders: () => {
      setSeen({ key, version: changes.latest });
      void queryClient.resetQueries({ queryKey: options.queryKey });
    },
  };
}
