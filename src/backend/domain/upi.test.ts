// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "./state";
import { buildUpiIntent, formatUpiAmount, isUpiRequestExpired, UPI_PAYEE } from "./upi";

describe("buildUpiIntent", () => {
  const intent = buildUpiIntent({ paymentId: "pay_7", orderId: "ord_3", amountMinor: 303_729 });

  it("carries every parameter a merchant payment needs", () => {
    const url = new URL(intent);
    expect(url.protocol).toBe("upi:");
    expect(url.host).toBe("pay");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      pa: UPI_PAYEE.address,
      pn: "admit-one",
      mc: "7922",
      tr: "pay_7", // unique per payment, so the confirmation matches it
      tn: "admit-one order ord_3",
      am: "3037.29",
      cu: "INR",
    });
  });

  it("encodes spaces as %20, never +, and leaves the address readable", () => {
    expect(intent).toContain("tn=admit-one%20order%20ord_3");
    expect(intent).not.toContain("+");
    expect(intent).toContain("pa=admit-one@example&");
  });

  it("pays an address no bank can resolve", () => {
    expect(UPI_PAYEE.address.endsWith("@example")).toBe(true);
  });
});

describe("formatUpiAmount", () => {
  it.each([
    [303_729, "3037.29"],
    [50, "0.50"],
    [5, "0.05"],
    [100_000, "1000.00"],
  ])("writes %i paise as %s rupees, always with two decimals", (amountMinor, rupees) => {
    expect(formatUpiAmount(amountMinor)).toBe(rupees);
  });
});

describe("isUpiRequestExpired", () => {
  const request: PaymentRecord = {
    id: "pay_1",
    orderId: "ord_1",
    method: "upi",
    amountMinor: 100,
    status: "requires_action",
    failureCode: null,
    webhookLagMs: null,
    expiresAtMs: 1_000,
    createdAtMs: 0,
  };

  it("expires a waiting request at its expiry, not a moment before", () => {
    expect(isUpiRequestExpired(request, 999)).toBe(false);
    expect(isUpiRequestExpired(request, 1_000)).toBe(true);
  });

  it("never expires a request the buyer has approved, or a card payment", () => {
    expect(isUpiRequestExpired({ ...request, status: "processing" }, 5_000)).toBe(false);
    const card: PaymentRecord = { ...request, method: "card", last4: "4242" };
    expect(isUpiRequestExpired(card, 5_000)).toBe(false);
  });
});
