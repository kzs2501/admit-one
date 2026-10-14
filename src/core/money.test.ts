// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "./catalog";
import { priceOrder, SERVICE_FEE_LABEL, type PricedEvent } from "./money";

const summit = getEvent("frontend-systems-summit");

/** An event with one tier at the given price, for fee-rounding cases. */
const eventPricedAt = (priceCents: number): PricedEvent => ({
  slug: "test",
  tiers: [{ id: "t", priceCents }],
  addOns: [],
});

describe("priceOrder", () => {
  it("prices tickets, add-ons and the fee in integer cents", () => {
    const amounts = priceOrder(summit, [{ tierId: "fss-general", quantity: 1 }], {});
    expect(amounts).toEqual({ ticketsCents: 14900, addOnsCents: 0, feesCents: 447, totalCents: 15347 });
    for (const cents of Object.values(amounts)) expect(Number.isInteger(cents)).toBe(true);
  });

  it("rounds the fee half-up without floats", () => {
    // 3% of $0.50 = 1.5¢ → 2¢; 3% of $0.49 = 1.47¢ → 1¢
    expect(priceOrder(eventPricedAt(50), [{ tierId: "t", quantity: 1 }], {}).feesCents).toBe(2);
    expect(priceOrder(eventPricedAt(49), [{ tierId: "t", quantity: 1 }], {}).feesCents).toBe(1);
  });

  it("rejects tiers and add-ons from other events", () => {
    expect(() => priceOrder(summit, [{ tierId: "nmj-standing", quantity: 1 }], {})).toThrow();
    expect(() => priceOrder(summit, [], { nope: 1 })).toThrow();
  });

  it("labels the fee from the same constant it charges", () => {
    expect(SERVICE_FEE_LABEL).toBe("3%");
  });
});
