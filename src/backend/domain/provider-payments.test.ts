/**
 * Settling a hosted checkout's payment from what its provider reports: tickets when it
 * can, and otherwise the money back, asked for, never just written down.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, testAttendees, valueOf } from "@/backend/testing/fixtures";
import type { BackendContext } from "./context";
import { hasItsTicketsInSandbox } from "./inventory";
import { cancelPayment, CHECKOUT_WINDOW_MS, createPayment } from "./payments";
import { settleObservedPayment, type ObservedPayment } from "./provider-payments";

/** A sandbox's state, behind a context whose provider is a hosted checkout. */
function checkoutContext() {
  const { backend, clock } = createTestBackend();
  const { hold } = valueOf(
    backend.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] }),
  );
  const { order } = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(1), addOns: {} }));
  const context: BackendContext = {
    state: backend.getState(),
    deps: {
      now: clock.now,
      newId: (prefix) => `${prefix}_x`,
      newToken: () => "t",
      random: () => 0.42,
      signTicket: () => "signed",
    },
    chaos: () => DEFAULT_CHAOS,
    log: () => undefined,
    hasItsTickets: (held) => hasItsTicketsInSandbox(context, held),
    paymentMethods: ["razorpay"],
    razorpayKeyId: "rzp_test_unit",
  };
  let checkouts = 0;
  const openCheckout = () => {
    checkouts += 1;
    const attempt = valueOf(
      createPayment(
        context,
        order.id,
        { method: "razorpay" },
        {
          paymentId: `pay_${String(checkouts)}`,
          providerOrderId: `order_${String(checkouts)}`,
          amountMinor: order.amounts.totalMinor,
        },
      ),
    );
    return attempt.payment.id;
  };
  const observed = (overrides: Partial<ObservedPayment> = {}): ObservedPayment => ({
    providerPaymentId: "pay_provider_1",
    status: "captured",
    amountMinor: order.amounts.totalMinor,
    currency: "INR",
    instrument: "card",
    last4: "1111",
    occurredAtMs: clock.now(),
    ...overrides,
  });
  return { context, clock, orderId: order.id, openCheckout, observed };
}

describe("settling a hosted checkout's payment", () => {
  it("issues tickets for a capture while the hold is live, and does nothing the second time", () => {
    const { context, orderId, openCheckout, observed } = checkoutContext();
    const paymentId = openCheckout();
    expect(settleObservedPayment(context, paymentId, observed())).toEqual({ outcome: "fulfilled", commands: [] });
    expect(context.state.orders[orderId]).toMatchObject({ status: "fulfilled" });
    expect(context.state.payments[paymentId]).toMatchObject({
      providerPaymentId: "pay_provider_1",
      instrument: "card",
    });
    expect(settleObservedPayment(context, paymentId, observed())).toEqual({ outcome: "already-settled", commands: [] });
  });

  it("asks for authorised money to be captured, once", () => {
    const { context, openCheckout, observed } = checkoutContext();
    const paymentId = openCheckout();
    const held = observed({ status: "authorized" });
    expect(settleObservedPayment(context, paymentId, held)).toMatchObject({
      outcome: "capturing",
      commands: [{ kind: "capture", paymentId, providerPaymentId: "pay_provider_1" }],
    });
    expect(settleObservedPayment(context, paymentId, held)).toEqual({ outcome: "capturing", commands: [] });
  });

  it("keeps the checkout open after a failed attempt", () => {
    const { context, openCheckout, observed } = checkoutContext();
    const paymentId = openCheckout();
    expect(settleObservedPayment(context, paymentId, observed({ status: "failed" }))).toEqual({
      outcome: "noted",
      commands: [],
    });
    expect(context.state.payments[paymentId]?.status).toBe("requires_action");
  });

  it("refunds a capture made after the hold ran out", () => {
    const { context, clock, orderId, openCheckout, observed } = checkoutContext();
    const paymentId = openCheckout();
    clock.advance(CHECKOUT_WINDOW_MS + 1);
    expect(settleObservedPayment(context, paymentId, observed({ occurredAtMs: clock.now() }))).toMatchObject({
      outcome: "refunded",
      commands: [{ kind: "refund", paymentId }],
    });
    expect(context.state.orders[orderId]?.status).toBe("refunded");
  });

  it("refunds a capture the order can't take, and leaves the order alone", () => {
    const { context, orderId, openCheckout, observed } = checkoutContext();
    const first = openCheckout();
    valueOf(cancelPayment(context, first));
    const second = openCheckout();

    expect(settleObservedPayment(context, first, observed({ providerPaymentId: "pay_stray" }))).toMatchObject({
      outcome: "refunded",
      commands: [{ kind: "refund", providerPaymentId: "pay_stray" }],
    });
    expect(context.state.orders[orderId]).toMatchObject({ status: "pending", paymentId: second });
    expect(settleObservedPayment(context, second, observed({ amountMinor: 1 }))).toMatchObject({ outcome: "refunded" });
    // Held, not taken: the provider releases it, so there's nothing to refund.
    expect(
      settleObservedPayment(context, first, observed({ providerPaymentId: "pay_held", status: "authorized" })),
    ).toEqual({
      outcome: "noted",
      commands: [],
    });
  });

  it("ignores a report about a payment that isn't a checkout", () => {
    const { context, observed } = checkoutContext();
    expect(settleObservedPayment(context, "pay_missing", observed())).toEqual({ outcome: "noted", commands: [] });
  });
});
