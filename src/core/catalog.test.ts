// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CATALOG, findEvent, getEvent } from "./catalog";

describe("catalogue", () => {
  it("has unique ids, and baselines within capacity", () => {
    const tiers = CATALOG.flatMap((event) => event.tiers);
    expect(new Set(tiers.map((tier) => tier.id)).size).toBe(tiers.length);
    for (const tier of tiers) expect(tier.baselineSold).toBeLessThan(tier.capacity);
  });

  it("finds events by slug, and throws only from getEvent", () => {
    expect(findEvent("night-market-jazz")?.name).toBe("Night Market Jazz");
    expect(findEvent("nope")).toBeUndefined();
    expect(() => getEvent("nope")).toThrow();
  });
});
