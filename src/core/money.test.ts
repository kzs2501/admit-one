// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "./catalog";
import { priceOrder, SERVICE_FEE_LABEL, type PricedEvent } from "./money";

const summit = getEvent("frontend-systems-summit");

/** An event with one tier at the given price, for fee-rounding cases. */
const eventPricedAt = (priceMinor: number): PricedEvent => ({
  slug: "test",
  currency: "INR",
  tiers: [{ id: "t", priceMinor }],
  addOns: [],
});

describe("priceOrder", () => {
  it("prices tickets, add-ons and the fee in integer minor units, in the event's currency", () => {
    const amounts = priceOrder(summit, [{ tierId: "fss-general", quantity: 1 }], {});
    expect(amounts).toEqual({
      currency: "INR",
      ticketsMinor: 499900,
      addOnsMinor: 0,
      feesMinor: 14997,
      totalMinor: 514897,
    });
    const { ticketsMinor, addOnsMinor, feesMinor, totalMinor } = amounts;
    for (const amountMinor of [ticketsMinor, addOnsMinor, feesMinor, totalMinor]) {
      expect(Number.isInteger(amountMinor)).toBe(true);
    }
  });

  it("rounds the fee half-up without floats", () => {
    // 3% of 50 paise = 1.5 → 2; 3% of 49 paise = 1.47 → 1
    expect(priceOrder(eventPricedAt(50), [{ tierId: "t", quantity: 1 }], {}).feesMinor).toBe(2);
    expect(priceOrder(eventPricedAt(49), [{ tierId: "t", quantity: 1 }], {}).feesMinor).toBe(1);
  });

  it("rejects tiers and add-ons from other events", () => {
    expect(() => priceOrder(summit, [{ tierId: "nmj-standing", quantity: 1 }], {})).toThrow();
    expect(() => priceOrder(summit, [], { nope: 1 })).toThrow();
  });

  it("labels the fee from the same constant it charges", () => {
    expect(SERVICE_FEE_LABEL).toBe("3%");
  });
});
