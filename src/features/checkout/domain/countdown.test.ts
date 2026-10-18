import { describe, expect, it } from "vitest";
import { announcedMs, crossedThreshold } from "./countdown";

describe("hold countdown announcements", () => {
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
