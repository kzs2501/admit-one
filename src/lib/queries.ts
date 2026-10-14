/**
 * The app's queries, built with TanStack Query's `queryOptions` — each key next to
 * the function it identifies, so a key can't drift from its data, and the cache is
 * typed wherever it's read or written (`setQueryData(holdQueries.detail(id).queryKey, …)`).
 *
 * Keys run from general to specific, so invalidating `eventQueries.all()` refreshes
 * every event query at once.
 */
import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";

export const eventQueries = {
  all: () => ["events"] as const,
  list: () => queryOptions({ queryKey: [...eventQueries.all(), "list"], queryFn: apiClient.listEvents }),
  detail: (slug: string) =>
    queryOptions({ queryKey: [...eventQueries.all(), "detail", slug], queryFn: () => apiClient.getEvent(slug) }),
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
