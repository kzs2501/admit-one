// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CATALOG, findEvent, getEvent } from "./catalog";
import { ORGANISATIONS } from "./organisations";

describe("catalogue", () => {
  it("has unique ids, and baselines within capacity", () => {
    const tiers = CATALOG.flatMap((event) => event.tiers);
    expect(new Set(tiers.map((tier) => tier.id)).size).toBe(tiers.length);
    for (const tier of tiers) expect(tier.baselineSold).toBeLessThan(tier.capacity);
  });

  it("gives every event an organiser that exists", () => {
    const organisationIds: string[] = ORGANISATIONS.map((organisation) => organisation.id);
    for (const event of CATALOG) expect(organisationIds).toContain(event.organiserId);
  });

  it("sells every event in its organiser's currency, so the organiser's revenue is one sum", () => {
    for (const event of CATALOG) {
      expect(ORGANISATIONS.find((organisation) => organisation.id === event.organiserId)?.currency).toBe(
        event.currency,
      );
    }
  });

  it("finds events by slug, and throws only from getEvent", () => {
    expect(findEvent("night-market-jazz")?.name).toBe("Night Market Jazz");
    expect(findEvent("nope")).toBeUndefined();
    expect(() => getEvent("nope")).toThrow();
  });
});
