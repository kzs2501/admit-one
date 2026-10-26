// @vitest-environment node
/** Razorpay's payments, as the rules see a provider's payment. */
import { describe, expect, it } from "vitest";
import type { RazorpayPayment } from "./client";
import { observedPaymentOf, razorpayEventSchema } from "./events";

const payment = (overrides: Partial<RazorpayPayment> = {}): RazorpayPayment => ({
  id: "pay_1",
  order_id: "order_1",
  amount: 59_000,
  currency: "INR",
  status: "captured",
  method: "card",
  amount_refunded: 0,
  captured: true,
  card: { last4: "1111" },
  error_code: null,
  created_at: 1_793_000_000,
  ...overrides,
});

describe("a Razorpay payment, observed", () => {
  it("says what was paid, how, and when", () => {
    expect(observedPaymentOf(payment())).toEqual({
      providerPaymentId: "pay_1",
      status: "captured",
      amountMinor: 59_000,
      currency: "INR",
      instrument: "card",
      last4: "1111",
      occurredAtMs: 1_793_000_000_000,
    });
    expect(observedPaymentOf(payment({ method: "upi", card: null }))).toMatchObject({ instrument: "upi", last4: null });
  });

  it("counts a refunded payment as captured, and one not yet attempted as nothing", () => {
    expect(observedPaymentOf(payment({ status: "refunded" }))?.status).toBe("captured");
    expect(observedPaymentOf(payment({ status: "created" }))).toBeNull();
  });

  it("reads Razorpay's event envelope, whatever else it carries", () => {
    const event = razorpayEventSchema.parse({
      entity: "event",
      account_id: "acc_1",
      event: "payment.captured",
      contains: ["payment"],
      payload: { payment: { entity: { ...payment(), vpa: null, email: "a@example.com" } } },
      created_at: 1_793_000_001,
    });
    expect(event.payload.payment?.entity).not.toHaveProperty("email");
  });
});
