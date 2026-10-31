// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "@/core/catalog";
import { tierTones } from "./tier-tones";

describe("tierTones", () => {
  it("gives the dearest tier the first tone, whatever order the tiers are listed in", () => {
    const tones = tierTones([
      { id: "balcony", priceMinor: 89_900 },
      { id: "premium", priceMinor: 249_900 },
      { id: "stalls", priceMinor: 149_900 },
    ]);
    expect([...tones]).toEqual([
      ["premium", 1],
      ["stalls", 2],
      ["balcony", 3],
    ]);
  });

  it("lets tiers past the third share its tone", () => {
    const tones = tierTones([400, 300, 200, 100].map((priceMinor) => ({ id: `t${priceMinor}`, priceMinor })));
    expect(tones.get("t200")).toBe(3);
    expect(tones.get("t100")).toBe(3);
  });

  it("colours the seated event's three tiers apart", () => {
    const tones = tierTones(getEvent("monsoon-strings").tiers);
    expect(new Set(tones.values())).toEqual(new Set([1, 2, 3]));
  });
});
