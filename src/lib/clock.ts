/**
 * Time on screen. Remaining time is always computed from a deadline and the current
 * clock — never by decrementing a counter — so a backgrounded tab, a slow render or a
 * missed tick can't make it drift. Shared by everything that counts down: the hold
 * timer, the waiting room, a "try again in…" notice.
 */
import { useEffect, useState } from "react";

/**
 * Client clock correction: if the server says it's later than our clock does, add
 * the difference. Measured once, when a response carrying the server's time arrives.
 */
export const clockOffset = (serverNow: number, receivedAt: number) => serverNow - receivedAt;

export const remainingMs = (deadlineMs: number, now: number, offset = 0) => Math.max(0, deadlineMs - (now + offset));

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
