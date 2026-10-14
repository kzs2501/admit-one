import { describe, expect, it } from "vitest";
import { announcedMs, clockOffset, crossedThreshold, formatRemaining, remainingMs, spokenRemaining } from "./countdown";

describe("countdown", () => {
  it("computes from expiresAt and corrects for clock skew", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    // The server is 2s ahead of us, so we have 2s less than our clock suggests.
    expect(remainingMs(10_000, 4_000, clockOffset(6_000, 4_000))).toBe(4_000);
    expect(remainingMs(10_000, 20_000)).toBe(0);
  });

  it("formats for eyes and for ears", () => {
    expect(formatRemaining(245_000)).toBe("4:05");
    expect(formatRemaining(8_200)).toBe("0:09");
    expect(spokenRemaining(245_000)).toBe("4 minutes 5 seconds");
    expect(spokenRemaining(60_000)).toBe("1 minute");
    expect(spokenRemaining(1_000)).toBe("1 second");
  });

  it("announces each threshold once, even if a second is skipped", () => {
    expect(crossedThreshold(121_000, 120_000)).toBe(120);
    expect(crossedThreshold(120_000, 119_000)).toBeNull();
    expect(crossedThreshold(64_000, 55_000)).toBe(60); // backgrounded tab jumped
    expect(crossedThreshold(90_000, 89_000)).toBeNull();
    expect(crossedThreshold(130_000, 25_000)).toBe(30); // jumped past all three: the latest wins
  });

  it("says the round number when on time, the real time after a long skip", () => {
    expect(announcedMs(120, 119_000)).toBe(120_000);
    expect(announcedMs(30, 14_000)).toBe(14_000);
  });
});
