"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ordersChangedEventSchema } from "@/contract/dto";
import { API_ROUTES, buildApiPath } from "@/contract/routes";
import { readEventStream, StreamError } from "@/lib/event-stream";
import { authorization } from "@/lib/organiser-api";
import { saveOrganiserToken } from "@/lib/organiser-session";
import { organiserQueries } from "@/lib/queries";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "paused";

/** At most one refresh a second, however busy the sale: the last change in a burst still lands. */
export const REFRESH_AT_MOST_EVERY_MS = 1_000;
/** While the stream is down, poll this often instead. */
export const FALLBACK_POLL_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/**
 * How long to wait before reconnecting: "full jitter" (AWS Architecture Blog,
 * "Exponential Backoff and Jitter"), so clients that dropped together don't all
 * come back at the same moment.
 */
export const reconnectDelayMs = (attempt: number, random: () => number = Math.random) =>
  random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);

/** Polling stands in only while the stream is down — and stops, like everything else, when updates are paused. */
export const pollIntervalFor = (status: LiveStatus) =>
  status === "live" || status === "paused" ? false : FALLBACK_POLL_MS;

interface LiveUpdates {
  status: LiveStatus;
  isPaused: boolean;
  setIsPaused: (isPaused: boolean) => void;
  /**
   * Changes counted as they arrive: `latest` goes up with each one, and each event
   * remembers the count at its last change. A view that noted `latest` when it loaded
   * can tell whether anything it shows has changed since.
   */
  changes: { latest: number; byEvent: Readonly<Record<string, number>> };
}

const LiveUpdatesContext = createContext<LiveUpdates | null>(null);

export function useLiveUpdates(): LiveUpdates {
  const live = useContext(LiveUpdatesContext);
  if (!live) throw new Error("useLiveUpdates needs a LiveUpdatesProvider");
  return live;
}

/**
 * One stream for the whole dashboard. Each `ordersChanged` refreshes what's on screen
 * — the metrics and any open order — and tells the orders table, which offers the
 * new rows rather than moving the list under the reader. Updates can be paused
 * (WCAG 2.2.2), which stops the stream and any polling.
 */
export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isPaused, setIsPaused] = useState(false);
  const [connection, setConnection] = useState<Exclude<LiveStatus, "paused">>("connecting");
  const [changes, setChanges] = useState<LiveUpdates["changes"]>({ latest: 0, byEvent: {} });
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    if (isPaused) return;
    const controller = new AbortController();
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();

    const refresh = () => {
      refreshTimer = undefined;
      lastRefreshAt.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: organiserQueries.metricsAll() });
      void queryClient.invalidateQueries({ queryKey: organiserQueries.orderAll() });
      const slugs = [...pending];
      pending.clear();
      setChanges(({ latest, byEvent }) => ({
        latest: latest + 1,
        byEvent: { ...byEvent, ...Object.fromEntries(slugs.map((slug) => [slug, latest + 1])) },
      }));
    };
    const changed = (slugs: readonly string[]) => {
      for (const slug of slugs) pending.add(slug);
      if (refreshTimer) return;
      const wait = Math.max(0, lastRefreshAt.current + REFRESH_AT_MOST_EVERY_MS - Date.now());
      refreshTimer = setTimeout(refresh, wait);
    };

    const connect = async () => {
      const isReconnect = attempt > 0;
      try {
        await readEventStream(buildApiPath(API_ROUTES.organiserStream, {}), {
          headers: authorization(),
          signal: controller.signal,
          onOpen: () => {
            setConnection("live");
            // Events may have been missed while it was down: catch up on everything.
            if (isReconnect) void queryClient.invalidateQueries({ queryKey: organiserQueries.all() });
            attempt = 0;
          },
          onEvent: (event) => {
            if (event.type !== "ordersChanged") return;
            const parsed = ordersChangedEventSchema.safeParse(JSON.parse(event.data));
            if (parsed.success) changed(parsed.data.eventSlugs);
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof StreamError && error.status === 401) {
          saveOrganiserToken(null); // the session is over; the dashboard goes back to signing in
          return;
        }
      }
      if (controller.signal.aborted) return;
      attempt += 1;
      setConnection("reconnecting");
      reconnectTimer = setTimeout(() => void connect(), reconnectDelayMs(attempt));
    };
    void connect();

    return () => {
      controller.abort();
      clearTimeout(reconnectTimer);
      clearTimeout(refreshTimer);
    };
  }, [isPaused, queryClient]);

  const value = useMemo<LiveUpdates>(
    () => ({
      status: isPaused ? "paused" : connection,
      isPaused,
      setIsPaused: (shouldPause) => {
        if (!shouldPause) setConnection("connecting");
        setIsPaused(shouldPause);
      },
      changes,
    }),
    [isPaused, connection, changes],
  );
  return <LiveUpdatesContext.Provider value={value}>{children}</LiveUpdatesContext.Provider>;
}
