/**
 * Rate limiting for the HTTP adapter: a sliding-window log. It remembers when each
 * recent request arrived and lets another through only if fewer than `limit` arrived
 * in the last `windowMs` — exact, with none of the bursts a fixed window allows at
 * its boundary, and small enough for one client's handful of requests.
 *
 * Refused requests are logged too, so a client that keeps hammering keeps itself
 * waiting, while one that waits as long as `Retry-After` says gets straight in.
 *
 * It lives in the adapter's memory, per client — here, the browser tab's sandbox. A
 * real service would keep the log in shared storage (Redis, say), keyed by account
 * or IP; RFC 6585 leaves "who is the client" to the server.
 */

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export type RateDecision = { isAllowed: true } | { isAllowed: false; retryAfterMs: number };

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
