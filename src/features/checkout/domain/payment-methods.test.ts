import { describe, expect, it } from "vitest";
import type { OrderDto } from "@/contract/dto";
import { orderWithPayment, UPI_INTENT, upiPaymentDto } from "@/features/checkout/testing/fixtures";
import { chosenPaymentMethod, offeredPaymentMethods, pendingUpiRequest, upiOutcome } from "./payment-methods";

const offering = (paymentMethods: OrderDto["paymentMethods"]): OrderDto => ({
  ...orderWithPayment(null),
  paymentMethods,
});

describe("payment methods", () => {
  it("offers what the backend offers for the order, in the registry's order", () => {
    expect(offeredPaymentMethods(offering(["upi", "card"])).map((option) => option.id)).toEqual(["card", "upi"]);
    expect(offeredPaymentMethods(offering(["card"])).map((option) => option.id)).toEqual(["card"]);
  });

  it("shows the buyer's choice if it's offered, and the first offered otherwise", () => {
    expect(chosenPaymentMethod(offering(["card", "upi"]), "upi")).toBe("upi");
    expect(chosenPaymentMethod(offering(["card"]), "upi")).toBe("card");
    expect(chosenPaymentMethod(offering(["card", "upi"]), undefined)).toBe("card");
    expect(chosenPaymentMethod(offering(["upi"]), undefined)).toBe("upi");
  });

  it("finds a UPI request waiting for the buyer, and nothing else", () => {
    expect(pendingUpiRequest(orderWithPayment(upiPaymentDto()))).toEqual({
      paymentId: "pay_1",
      intentUri: UPI_INTENT,
      expiresAt: new Date(5 * 60_000).toISOString(),
    });
    expect(pendingUpiRequest(orderWithPayment(upiPaymentDto({ status: "processing", nextAction: null })))).toBeNull();
    const challenge = upiPaymentDto({ method: "card", last4: "3155", nextAction: { type: "card_challenge" } });
    expect(pendingUpiRequest(orderWithPayment(challenge))).toBeNull();
    expect(pendingUpiRequest(orderWithPayment(null))).toBeNull();
  });

  it("says how a UPI payment ended without paying", () => {
    const ended = (failureCode: "upi_declined" | "upi_expired" | "cancelled") =>
      upiOutcome(orderWithPayment(upiPaymentDto({ status: "failed", failureCode, nextAction: null }), "failed"));
    expect(ended("upi_declined")).toMatchObject({ tone: "bad", title: "UPI payment declined" });
    expect(ended("upi_expired")).toMatchObject({ tone: "bad", title: "UPI request expired" });
    expect(ended("cancelled")).toMatchObject({ tone: "info", title: "UPI request cancelled" });
  });

  it("says nothing for an order that isn't a failed UPI payment", () => {
    expect(upiOutcome(orderWithPayment(upiPaymentDto()))).toBeNull();
    const declinedCard = upiPaymentDto({ method: "card", status: "failed", failureCode: "card_declined" });
    expect(upiOutcome(orderWithPayment(declinedCard, "failed"))).toBeNull();
    const oddFailure = upiPaymentDto({ status: "failed", failureCode: null, nextAction: null });
    expect(upiOutcome(orderWithPayment(oddFailure, "failed"))).toBeNull();
  });
});
