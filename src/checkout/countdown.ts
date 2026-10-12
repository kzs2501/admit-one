/**
 * The hold countdown. Remaining time is always computed from the server's
 * `expiresAt` and the current clock — never by decrementing a counter — so a
 * backgrounded tab, a slow render or a missed tick can't make it drift.
 */
import { useEffect, useState } from "react";

/** Moments worth announcing to screen readers. Anything more frequent is noise. */
export const ANNOUNCE_AT_SECONDS = [120, 60, 30] as const;

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
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m && s) return `${part(m, "minute")} ${part(s, "second")}`;
  return m ? part(m, "minute") : part(s, "second");
}

/**
 * Which threshold, if any, did we just cross? Comparing the previous and current
 * reading means a skipped second (backgrounded tab) still triggers the
 * announcement, and it fires exactly once.
 */
export function crossedThreshold(previousMs: number, currentMs: number): number | null {
  for (const s of ANNOUNCE_AT_SECONDS) {
    if (previousMs > s * 1000 && currentMs <= s * 1000) return s;
  }
  return null;
}

/**
 * The current time, re-read at the top of every wall-clock second while `active`.
 * Aligning to the second boundary keeps the display changing on the beat instead of
 * at an arbitrary offset from it.
 */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [active]);
  return now;
}
