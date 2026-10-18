/**
 * When the hold countdown speaks. The clock itself (remaining time, formatting,
 * `useNow`) is shared, in `lib/clock.ts`; this is the checkout's own rule about which
 * moments are worth announcing to a screen reader.
 */

/** Moments worth announcing to screen readers. Anything more frequent is noise. */
const ANNOUNCE_AT_SECONDS = [120, 60, 30] as const;

/**
 * Which threshold, if any, did we just cross? Comparing the previous and current
 * reading means a skipped second (backgrounded tab) still triggers the
 * announcement, and it fires exactly once. If a jump crosses several, the smallest
 * one wins: a tab that slept from 2:10 to 0:25 has crossed 30 s, not 2 min.
 */
export function crossedThreshold(previousMs: number, currentMs: number): number | null {
  for (const thresholdSeconds of [...ANNOUNCE_AT_SECONDS].reverse()) {
    if (previousMs > thresholdSeconds * 1000 && currentMs <= thresholdSeconds * 1000) return thresholdSeconds;
  }
  return null;
}

const ON_TIME_MS = 5_000;

/**
 * What to say on crossing a threshold: the round number when we're on time (or a
 * second or two late), and the real time left when a sleeping tab skipped well past
 * it — "1 minute", not "59 seconds"; "14 seconds", not "30 seconds".
 */
export const announcedMs = (thresholdSeconds: number, leftMs: number) =>
  thresholdSeconds * 1000 - leftMs < ON_TIME_MS ? thresholdSeconds * 1000 : leftMs;
