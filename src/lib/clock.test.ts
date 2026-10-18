import { describe, expect, it } from "vitest";
import { clockOffset, formatRemaining, remainingMs, spokenRemaining } from "./clock";

describe("clock", () => {
  it("computes from a deadline and corrects for clock skew", () => {
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
});
