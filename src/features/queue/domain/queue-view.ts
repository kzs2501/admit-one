/**
 * What the waiting room shows, decided from the server's latest word on your place —
 * a pure function, so every state is unit-tested — and which moments are worth
 * announcing. Like the hold timer, it speaks at milestones, not on every update.
 */
import type { QueueEntryDto } from "@/contract/dto";

export type QueueView =
  | {
      kind: "waiting";
      aheadCount: number;
      /** How far through the line you are, 0 to 1. It only ever grows: your place only ever improves. */
      progress: number;
      estimatedWaitMs: number;
    }
  | { kind: "admitted"; admittedUntilMs: number }
  | { kind: "expired" };

export function toQueueView(entry: QueueEntryDto): QueueView {
  switch (entry.status) {
    case "waiting":
      return {
        kind: "waiting",
        aheadCount: entry.aheadCount,
        progress: entry.aheadAtJoin === 0 ? 1 : 1 - entry.aheadCount / entry.aheadAtJoin,
        estimatedWaitMs: entry.estimatedWaitSeconds * 1000,
      };
    case "admitted":
      return { kind: "admitted", admittedUntilMs: Date.parse(entry.admittedUntil ?? entry.serverTime) };
    case "expired":
      return { kind: "expired" };
  }
}

/** Fractions of the line still ahead worth saying out loud. */
const MILESTONES = [
  { remaining: 0.5, words: "You’re halfway there." },
  { remaining: 0.25, words: "Nearly there." },
] as const;

/**
 * Which milestone, if any, did the line just pass? Compares the previous and current
 * reading, so a long gap between updates still announces once — the latest milestone
 * passed, as the hold timer does.
 */
export function passedMilestone(previousAhead: number, currentAhead: number, aheadAtJoin: number): string | null {
  let passed: string | null = null;
  for (const { remaining, words } of MILESTONES) {
    const threshold = aheadAtJoin * remaining;
    if (previousAhead > threshold && currentAhead <= threshold) passed = words;
  }
  return passed;
}
