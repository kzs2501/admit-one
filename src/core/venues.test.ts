// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "./catalog";
import { baselineSoldSeatIds, RANGMANCH_PLAN } from "./venues";

describe("Rangmanch Auditorium", () => {
  it("has about a thousand seats in two sections, with no I or O rows", () => {
    expect(RANGMANCH_PLAN.seats).toHaveLength(998);
    expect(RANGMANCH_PLAN.sections.map((section) => section.rows.length)).toEqual([20, 12]);
    const rowLabels = RANGMANCH_PLAN.seats.map((seat) => seat.rowLabel);
    expect(rowLabels).not.toContain("I");
    expect(rowLabels).not.toContain("O");
  });

  it("marks the wheelchair spaces at the ends of the last stalls row", () => {
    const spaces = RANGMANCH_PLAN.seats.filter((seat) => seat.isWheelchairSpace).map((seat) => seat.id);
    expect(spaces).toEqual(["stalls-V-1", "stalls-V-34"]);
  });

  it("sells the same seats before every sandbox, busier at the front", () => {
    const sold = baselineSoldSeatIds(RANGMANCH_PLAN, 2026);
    expect([...sold]).toEqual([...baselineSoldSeatIds(RANGMANCH_PLAN, 2026)]);
    const soldShare = (rowLabel: string) => {
      const row = RANGMANCH_PLAN.seats.filter((seat) => seat.sectionId === "stalls" && seat.rowLabel === rowLabel);
      return row.filter((seat) => sold.has(seat.id)).length / row.length;
    };
    const front = ["A", "B", "C", "D"].map(soldShare);
    const back = ["S", "T", "U", "V"].map(soldShare);
    expect(front.reduce((sum, share) => sum + share) / 4).toBeGreaterThan(back.reduce((sum, share) => sum + share) / 4);
  });

  it("gives each tier its seats' count as capacity, so the tier picker and the map agree", () => {
    const event = getEvent("monsoon-strings");
    expect(event.seating.kind).toBe("reserved");
    const capacity = event.tiers.reduce((sum, tier) => sum + tier.capacity, 0);
    expect(capacity).toBe(RANGMANCH_PLAN.seats.length);
    for (const tier of event.tiers) expect(tier.baselineSold, tier.id).toBeLessThan(tier.capacity);
  });
});
