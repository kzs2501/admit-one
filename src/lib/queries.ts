/**
 * The app's queries, built with TanStack Query's `queryOptions` — each key next to
 * the function it identifies, so a key can't drift from its data, and the cache is
 * typed wherever it's read or written (`setQueryData(holdQueries.detail(id).queryKey, …)`).
 *
 * Keys run from general to specific, so invalidating `eventQueries.all()` refreshes
 * every event query at once.
 */
import { queryOptions } from "@tanstack/react-query";
import { apiClient, isTransientError } from "./api-client";

/**
 * Whether a query's error should replace what's on screen. Before there's any data,
 * always. After, only an answer does (`not_found`, say): a glitch while refreshing keeps
 * the last good data on screen, and a toast says it may be stale. After TkDodo's
 * "Status Checks in React Query": check for data before checking for errors.
 */
export function shouldShowQueryError(data: unknown, error: unknown): boolean {
  if (error === null || error === undefined) return false;
  return data === undefined || !isTransientError(error);
}

export const eventQueries = {
  all: () => ["events"] as const,
  list: () => queryOptions({ queryKey: [...eventQueries.all(), "list"], queryFn: apiClient.listEvents }),
  detail: (slug: string) =>
    queryOptions({ queryKey: [...eventQueries.all(), "detail", slug], queryFn: () => apiClient.getEvent(slug) }),
};

/** Which seats are gone, for an event with reserved seating. */
export const seatQueries = {
  all: () => ["seats"] as const,
  availability: (slug: string) =>
    queryOptions({ queryKey: [...seatQueries.all(), slug], queryFn: () => apiClient.getSeatAvailability(slug) }),
};

export const holdQueries = {
  all: () => ["holds"] as const,
  detail: (holdId: string) =>
    queryOptions({ queryKey: [...holdQueries.all(), holdId], queryFn: () => apiClient.getHold(holdId) }),
};

export const orderQueries = {
  all: () => ["orders"] as const,
  detail: (orderId: string) =>
    queryOptions({ queryKey: [...orderQueries.all(), orderId], queryFn: () => apiClient.getOrder(orderId) }),
};
