import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueueEntryDto } from "@/contract/dto";
import { apiClient, problemOf } from "@/lib/api-client";
import { queueQueries } from "@/lib/queries";
import { saveQueueToken, useQueueToken } from "@/lib/queue-token";
import { toQueueView, type QueueView } from "@/features/queue/domain/queue-view";

export interface QueueEntryModel {
  entry: QueueEntryDto | undefined;
  view: QueueView | null;
  /** True while a saved place is being looked up. */
  isChecking: boolean;
  join: (options?: { onJoined?: () => void }) => void;
  isJoining: boolean;
  joinError: Error | null;
}

/**
 * Your place in a sale's waiting room. The token lives in this tab's storage; the place
 * itself is the server's, polled exactly as often as the server says
 * (`checkAgainAfterSeconds`) and not at all while the tab is hidden.
 */
export function useQueueEntry(slug: string): QueueEntryModel {
  const queryClient = useQueryClient();
  const token = useQueueToken(slug);
  const query = useQuery({
    ...queueQueries.entry(token ?? ""),
    enabled: token !== null,
    refetchInterval: (current) => {
      const seconds = current.state.data?.checkAgainAfterSeconds ?? 0;
      return seconds > 0 ? seconds * 1000 : false;
    },
  });

  // A token from a sandbox that has since been reset points nowhere: forget it, so the
  // page offers to join again instead of waiting on a place that doesn't exist.
  const isUnknownToken = problemOf(query.error)?.code === "not_found";
  useEffect(() => {
    if (isUnknownToken) saveQueueToken(slug, null);
  }, [isUnknownToken, slug]);

  const join = useMutation({
    mutationFn: () => apiClient.joinQueue(slug),
    onSuccess: (entry) => {
      queryClient.setQueryData(queueQueries.entry(entry.token).queryKey, entry);
      saveQueueToken(slug, entry.token);
    },
  });

  const entry = token === null ? undefined : query.data;
  return {
    entry,
    view: entry ? toQueueView(entry) : null,
    isChecking: token !== null && query.isPending,
    join: (options) => {
      join.mutate(undefined, { onSuccess: () => options?.onJoined?.() });
    },
    isJoining: join.isPending,
    joinError: join.error,
  };
}
