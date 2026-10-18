import { describe, expect, it } from "vitest";
import type { QueueEntryDto } from "@/contract/dto";
import { passedMilestone, toQueueView } from "./queue-view";

const entry = (overrides: Partial<QueueEntryDto>): QueueEntryDto => ({
  token: "q_1",
  eventSlug: "open-studio-ceramics",
  status: "waiting",
  aheadCount: 40_000,
  aheadAtJoin: 40_000,
  estimatedWaitSeconds: 10,
  checkAgainAfterSeconds: 2,
  admittedUntil: null,
  serverTime: "2026-10-19T10:00:00.000Z",
  ...overrides,
});

describe("toQueueView", () => {
  it("shows how many are ahead, how far through you are, and the wait", () => {
    expect(toQueueView(entry({ aheadCount: 10_000, estimatedWaitSeconds: 4 }))).toEqual({
      kind: "waiting",
      aheadCount: 10_000,
      progress: 0.75,
      estimatedWaitMs: 4_000,
    });
    expect(toQueueView(entry({ aheadAtJoin: 0, aheadCount: 0 }))).toMatchObject({ progress: 1 });
  });

  it("knows when it's your turn, until when, and when it has passed", () => {
    const until = "2026-10-19T10:10:00.000Z";
    expect(toQueueView(entry({ status: "admitted", admittedUntil: until }))).toEqual({
      kind: "admitted",
      admittedUntilMs: Date.parse(until),
    });
    expect(toQueueView(entry({ status: "expired" }))).toEqual({ kind: "expired" });
  });
});

describe("passedMilestone", () => {
  it("speaks at halfway and with a quarter left, once each", () => {
    expect(passedMilestone(24_000, 16_000, 40_000)).toBe("You’re halfway there.");
    expect(passedMilestone(16_000, 8_000, 40_000)).toBe("Nearly there.");
    expect(passedMilestone(32_000, 24_000, 40_000)).toBeNull();
    expect(passedMilestone(8_000, 0, 40_000)).toBeNull();
  });

  it("says only the latest when a long gap passes both", () => {
    expect(passedMilestone(40_000, 8_000, 40_000)).toBe("Nearly there.");
  });
});
