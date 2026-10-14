/**
 * The hold countdown. Remaining time is always computed from the server's
 * `expiresAt` and the current clock — never by decrementing a counter — so a
 * backgrounded tab, a slow render or a missed tick can't make it drift.
 */
import { useEffect, useState } from "react";

/** Moments worth announcing to screen readers. Anything more frequent is noise. */
const ANNOUNCE_AT_SECONDS = [120, 60, 30] as const;

/**
 * Client clock correction: if the server says it's later than our clock does, add
 * the difference. Measured once, when the hold response arrives.
 */
export const clockOffset = (serverNow: number, receivedAt: number) => serverNow - receivedAt;

export const remainingMs = (expiresAt: number, now: number, offset = 0) => Math.max(0, expiresAt - (now + offset));

/** 4:05, 0:09 */
export function formatRemaining(ms: number) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "4 minutes 5 seconds" — what a screen reader should say instead of "4:05". */
export function spokenRemaining(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const part = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (minutes && seconds) return `${part(minutes, "minute")} ${part(seconds, "second")}`;
  return minutes ? part(minutes, "minute") : part(seconds, "second");
}

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

/**
 * The current time, re-read at the top of every wall-clock second while `isActive`.
 * Aligning to the second boundary keeps the display changing on the beat instead of
 * at an arbitrary offset from it.
 */
export function useNow(isActive: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [isActive]);
  return now;
}
