import { describe, expect, it } from "vitest";
import { FALLBACK_POLL_MS, pollIntervalFor, reconnectDelayMs } from "./use-live-updates";

describe("live updates", () => {
  it("backs off with full jitter: anywhere from nothing up to a doubling cap, never past 30 s", () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(0);
    expect(reconnectDelayMs(1, () => 0.999)).toBeCloseTo(1_998);
    expect(reconnectDelayMs(3, () => 0.5)).toBe(4_000);
    expect(reconnectDelayMs(20, () => 0.999)).toBeLessThan(30_000);
  });

  it("polls only while the stream is down, and never while paused", () => {
    expect(pollIntervalFor("live")).toBe(false);
    expect(pollIntervalFor("paused")).toBe(false);
    expect(pollIntervalFor("reconnecting")).toBe(FALLBACK_POLL_MS);
    expect(pollIntervalFor("connecting")).toBe(FALLBACK_POLL_MS);
  });
});
