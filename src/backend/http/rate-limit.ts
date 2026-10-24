/**
 * Rate limiting for the HTTP adapter: a sliding-window log. It remembers when each
 * recent request arrived and lets another through only if fewer than `limit` arrived
 * in the last `windowMs` — exact, with none of the bursts a fixed window allows at
 * its boundary, and small enough for one client's handful of requests.
 *
 * Refused requests are logged too, so a client that keeps hammering keeps itself
 * waiting, while one that waits as long as `Retry-After` says gets straight in.
 *
 * Where the log lives is a `RateLimitStore`: in the adapter's memory for the sandbox,
 * whose one client is its browser tab, and in Postgres for a server
 * (`postgres/rate-limit.ts`), keyed by the client's IP. RFC 6585 leaves "who is the
 * client" to the server.
 */
import type { Awaitable } from "@/backend/port";

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export type RateDecision = { isAllowed: true } | { isAllowed: false; retryAfterMs: number };

/** Where each client's attempts are counted. */
export interface RateLimitStore {
  /** Count an attempt by this client, and say whether it may go ahead. */
  take: (clientKey: string, limit: RateLimit) => Awaitable<RateDecision>;
}

/** Clients remembered at once, in memory: more than a sandbox's one tab will ever be. */
const MAX_CLIENTS = 1_000;

/** One sliding window per client, in this process's memory. */
export function createSlidingWindowStore(now: () => number): RateLimitStore {
  const windows = new Map<string, ReturnType<typeof createSlidingWindow>>();
  return {
    take: (clientKey, limit) => {
      let window = windows.get(clientKey);
      if (!window) {
        if (windows.size >= MAX_CLIENTS) windows.clear();
        window = createSlidingWindow(now);
        windows.set(clientKey, window);
      }
      return window.take(limit);
    },
  };
}

export function createSlidingWindow(now: () => number) {
  let arrivals: number[] = [];

  return {
    /** Count a request, and say whether it may go ahead — and if not, when one could. */
    take({ limit, windowMs }: RateLimit): RateDecision {
      const nowMs = now();
      arrivals = arrivals.filter((arrivedAtMs) => arrivedAtMs > nowMs - windowMs);
      const isAllowed = arrivals.length < limit;
      arrivals.push(nowMs);
      if (isAllowed) return { isAllowed };
      // The next request is allowed once enough arrivals have aged out that fewer
      // than `limit` remain: when the arrival `limit` places from the newest leaves.
      const freedAtMs = (arrivals[arrivals.length - limit] ?? nowMs) + windowMs;
      return { isAllowed, retryAfterMs: Math.max(0, freedAtMs - nowMs) };
    },
  };
}
