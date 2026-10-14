// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAwaitingConfirmation, isAwaitingPayment, isPaidFor } from "./order-status";
import type { OrderStatus, PaymentStatus } from "./statuses";

const order = (status: OrderStatus, paymentStatus?: PaymentStatus) => ({
  status,
  payment: paymentStatus ? { status: paymentStatus } : null,
});

describe("order status predicates", () => {
  it("waits for confirmation only while the provider has the charge", () => {
    expect(isAwaitingConfirmation(order("pending", "processing"))).toBe(true);
    expect(isAwaitingConfirmation(order("paid", "succeeded"))).toBe(true);
    expect(isAwaitingConfirmation(order("pending", "requires_action"))).toBe(false);
    expect(isAwaitingConfirmation(order("fulfilled", "succeeded"))).toBe(false);
  });

  it("is waiting on the buyer when nothing is in flight", () => {
    expect(isAwaitingPayment(order("pending"))).toBe(true);
    expect(isAwaitingPayment(order("pending", "requires_action"))).toBe(true);
    expect(isAwaitingPayment(order("pending", "failed"))).toBe(true);
    expect(isAwaitingPayment(order("pending", "processing"))).toBe(false);
    expect(isAwaitingPayment(order("failed", "failed"))).toBe(false);
  });

  it("treats paid, fulfilled and refunded orders as paid for", () => {
    expect((["paid", "fulfilled", "refunded"] as const).every((status) => isPaidFor(order(status)))).toBe(true);
    expect((["pending", "failed", "expired"] as const).some((status) => isPaidFor(order(status)))).toBe(false);
  });
});
