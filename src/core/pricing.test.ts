// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "./catalog";
import { allInTicketPriceMinor, BOOKING_FEE_LABEL, gstOn, priceOrder, ticketPrice, type PricedEvent } from "./pricing";

/** An event with one tier at the given price, and one extra at 5%. */
const eventPricedAt = (priceMinor: number): PricedEvent => ({
  slug: "test",
  currency: "INR",
  tiers: [{ id: "t", priceMinor }],
  addOns: [{ id: "a", priceMinor: 45_000, gstRateBasisPoints: 500 }],
});

describe("ticketPrice", () => {
  it("prices a ₹2,499 ticket in full: fee, GST on the ticket, GST on the fee", () => {
    expect(ticketPrice(249_900)).toEqual({
      baseMinor: 249_900,
      feeMinor: 7_497, // 3%
      gstOnTicketMinor: 44_982, // 9% + 9% = 22,491 + 22,491
      gstOnFeeMinor: 1_350, // 9% + 9% of ₹74.97, each rounded up: 675 + 675
      allInMinor: 303_729, // ₹3,037.29
      isGstExempt: false,
    });
  });

  it.each([
    { baseMinor: 50_000, isGstExempt: true, gstOnTicketMinor: 0 }, // ₹500.00: exempt
    { baseMinor: 50_001, isGstExempt: false, gstOnTicketMinor: 9_000 }, // ₹500.01: 18%
    { baseMinor: 45_000, isGstExempt: true, gstOnTicketMinor: 0 },
  ])("treats $baseMinor paise as GST-exempt: $isGstExempt", ({ baseMinor, isGstExempt, gstOnTicketMinor }) => {
    expect(ticketPrice(baseMinor)).toMatchObject({ isGstExempt, gstOnTicketMinor });
  });

  it("still charges GST on the booking fee of an exempt ticket — the fee is a service", () => {
    expect(ticketPrice(45_000).gstOnFeeMinor).toBe(gstOn(1_350, 1_800));
    expect(ticketPrice(45_000).gstOnFeeMinor).toBeGreaterThan(0);
  });
});

describe("gstOn", () => {
  it("adds two separately rounded halves, so neither half is ever part of a paisa", () => {
    // 18% of 7,497 paise is 1,349.46; the halves are 674.73 → 675 each.
    expect(gstOn(7_497, 1_800)).toBe(1_350);
    expect(gstOn(7_497, 1_800) % 2).toBe(0);
    expect(gstOn(0, 1_800)).toBe(0);
  });
});

describe("priceOrder", () => {
  it("makes the order total exactly the per-ticket all-in price times the quantity", () => {
    for (const baseMinor of [1, 49, 50_000, 50_001, 89_900, 249_900, 1_199_900]) {
      for (const quantity of [1, 2, 3, 6]) {
        const amounts = priceOrder(eventPricedAt(baseMinor), [{ tierId: "t", quantity }], {});
        expect(amounts.totalMinor, `${baseMinor} × ${quantity}`).toBe(ticketPrice(baseMinor).allInMinor * quantity);
      }
    }
  });

  it("itemises GST by what it's on, and shows an exempt ticket as exempt", () => {
    const summit = getEvent("frontend-systems-summit");
    const amounts = priceOrder(summit, [{ tierId: "fss-general", quantity: 2 }], { "fss-lunch": 1, "fss-tee": 0 });
    expect(amounts.taxLines).toEqual([
      { kind: "tickets", rateBasisPoints: 1_800, taxableMinor: 999_800, amountMinor: 2 * gstOn(499_900, 1_800) },
      { kind: "booking-fee", rateBasisPoints: 1_800, taxableMinor: 29_994, amountMinor: 2 * gstOn(14_997, 1_800) },
      { kind: "add-ons", rateBasisPoints: 500, taxableMinor: 45_000, amountMinor: gstOn(45_000, 500) },
    ]);
    expect(amounts.taxMinor).toBe(amounts.taxLines.reduce((sum, line) => sum + line.amountMinor, 0));
    expect(amounts.totalMinor).toBe(amounts.ticketsMinor + amounts.addOnsMinor + amounts.feesMinor + amounts.taxMinor);

    const jazz = getEvent("night-market-jazz");
    const student = priceOrder(jazz, [{ tierId: "nmj-student", quantity: 1 }], {});
    expect(student.taxLines[0]).toEqual({
      kind: "tickets-exempt",
      rateBasisPoints: 0,
      taxableMinor: 45_000,
      amountMinor: 0,
    });
  });

  it("keeps every amount in whole paise", () => {
    const amounts = priceOrder(eventPricedAt(123_457), [{ tierId: "t", quantity: 3 }], { a: 2 });
    for (const value of [amounts.ticketsMinor, amounts.feesMinor, amounts.taxMinor, amounts.totalMinor]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("rejects tiers and add-ons from other events", () => {
    const summit = getEvent("frontend-systems-summit");
    expect(() => priceOrder(summit, [{ tierId: "nmj-standing", quantity: 1 }], {})).toThrow();
    expect(() => priceOrder(summit, [], { nope: 1 })).toThrow();
  });
});

describe("price labels", () => {
  it("label a tier with the same all-in number the order charges", () => {
    const monsoon = getEvent("monsoon-strings");
    expect(allInTicketPriceMinor(monsoon, "ms-premium")).toBe(303_729);
    expect(allInTicketPriceMinor(monsoon, "ms-premium")).toBe(
      priceOrder(monsoon, [{ tierId: "ms-premium", quantity: 1 }], {}).totalMinor,
    );
  });

  it("label the fee from the same rule it charges", () => {
    expect(BOOKING_FEE_LABEL).toBe("3%");
  });
});
