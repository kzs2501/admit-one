// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, testAttendees, testCard, valueOf } from "@/backend/testing/fixtures";
import { LAST_SECONDS_MS, PAYMENT_GRACE_MS, TEST_CARDS } from "./payments";
import { buildUpiIntent } from "./upi";

function openOrder(backend: ReturnType<typeof createTestBackend>["backend"]) {
  const { hold } = valueOf(
    backend.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] }),
  );
  return valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(1), addOns: {} })).order;
}

describe("payments", () => {
  it("blocks a second payment while one is in flight", () => {
    const { backend } = createTestBackend();
    const { order } = purchase(backend);
    expect(backend.createPayment(order.id, testCard())).toMatchObject({
      ok: false,
      error: { code: "payment_in_progress" },
    });
  });

  it("returns a declined charge as a failed payment, fails the order, and allows a retry", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    const declined = valueOf(backend.createPayment(order.id, testCard(TEST_CARDS.decline)));
    expect(declined.payment).toMatchObject({ status: "failed", failureCode: "card_declined" });
    expect(valueOf(backend.getOrder(order.id)).status).toBe("failed");

    expect(backend.createPayment(order.id, testCard()).ok).toBe(true);
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("handles the 3-D Secure challenge both ways", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    const first = valueOf(backend.createPayment(order.id, testCard(TEST_CARDS.challenge)));
    expect(first.payment.status).toBe("requires_action");
    const rejected = valueOf(backend.confirmChallenge(first.payment.id, "reject"));
    expect(rejected.payment).toMatchObject({ status: "failed", failureCode: "authentication_failed" });
    expect(valueOf(backend.getOrder(order.id)).status).toBe("failed");

    const second = valueOf(backend.createPayment(order.id, testCard(TEST_CARDS.challenge)));
    expect(valueOf(backend.confirmChallenge(second.payment.id, "approve")).payment.status).toBe("processing");
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("refuses to answer a challenge that isn't waiting", () => {
    const { backend } = createTestBackend();
    const { payment } = purchase(backend);
    expect(backend.confirmChallenge(valueOf(payment).payment.id, "approve")).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  it("extends the hold once when payment starts, so a slow bank doesn't cost the tickets", () => {
    const { backend } = createTestBackend();
    const { hold } = purchase(backend);
    expect(backend.getState().holds[hold.id]?.expiresAtMs).toBeGreaterThanOrEqual(hold.createdAtMs + PAYMENT_GRACE_MS);
  });
});

describe("UPI payments", () => {
  const UPI = { method: "upi" } as const;

  it("asks the buyer to approve in their UPI app, and keeps the hold as long as the request lasts", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    clock.advance(60_000); // a minute into a five-minute hold
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    const expiresAtMs = clock.now() + DEFAULT_CHAOS.upiRequestMs;
    expect(payment).toMatchObject({ method: "upi", status: "requires_action", last4: null, failureCode: null });
    expect(payment.nextAction).toEqual({
      type: "upi",
      intentUri: buildUpiIntent({ paymentId: payment.id, orderId: order.id, amountMinor: order.amounts.totalMinor }),
      expiresAtMs,
    });
    expect(backend.getState().holds[order.holdId]?.expiresAtMs).toBe(expiresAtMs);
    expect(backend.getPendingUpiRequest()).toEqual({
      paymentId: payment.id,
      payeeName: "admit-one",
      amountMinor: order.amounts.totalMinor,
      expiresAtMs,
    });
  });

  it("fulfils the order when the buyer approves — once the webhook says so", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    expect(valueOf(backend.respondInUpiApp(payment.id, "approve")).payment.status).toBe("processing");
    expect(backend.getPendingUpiRequest()).toBeNull();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("pending");
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id))).toMatchObject({
      status: "fulfilled",
      payment: { status: "succeeded" },
    });
  });

  it("fails the order when the buyer declines, and lets them pay by card instead", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    valueOf(backend.respondInUpiApp(payment.id, "decline"));
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id))).toMatchObject({
      status: "failed",
      statusReason: "The UPI payment was declined. No money was taken.",
      payment: { status: "failed", failureCode: "upi_declined" },
    });

    valueOf(backend.createPayment(order.id, testCard()));
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("hears a bank's decline from the webhook, even when the buyer approved", () => {
    const { backend, clock } = createTestBackend("upi-declined");
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    valueOf(backend.respondInUpiApp(payment.id, "approve"));
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id)).payment).toMatchObject({
      status: "failed",
      failureCode: "upi_declined",
    });
  });

  it("lets a request nobody approves run out, without a timer, and the buyer try again", () => {
    const { backend, clock } = createTestBackend("upi-expires");
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    clock.advance(15_000 - 1);
    expect(valueOf(backend.getOrder(order.id)).payment?.status).toBe("requires_action");
    clock.advance(1);
    expect(valueOf(backend.getOrder(order.id))).toMatchObject({
      status: "failed",
      payment: { status: "failed", failureCode: "upi_expired", nextAction: null },
    });
    expect(backend.getState().payments[payment.id]?.status).toBe("requires_action"); // the read didn't write
    expect(backend.getPendingUpiRequest()).toBeNull();
    expect(backend.respondInUpiApp(payment.id, "approve")).toMatchObject({ error: { code: "invalid_state" } });

    // No longer in flight: the buyer can pay again, and that write settles the old request.
    expect(valueOf(backend.createPayment(order.id, UPI)).payment.status).toBe("requires_action");
    expect(backend.getState().payments[payment.id]).toMatchObject({ status: "failed", failureCode: "upi_expired" });
  });

  it("never lets a request outlast the hold", () => {
    const { backend } = createTestBackend("hold-expires");
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    const lastSecondMs = order.createdAtMs + LAST_SECONDS_MS;
    expect(backend.getState().holds[order.holdId]?.expiresAtMs).toBe(lastSecondMs);
    expect(payment.nextAction).toMatchObject({ type: "upi", expiresAtMs: lastSecondMs });
  });

  it("cancels a request the buyer hasn't approved — twice is the same as once", () => {
    const { backend } = createTestBackend();
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    const cancelled = valueOf(backend.cancelPayment(payment.id));
    expect(cancelled.payment).toMatchObject({ status: "failed", failureCode: "cancelled" });
    expect(cancelled.order).toMatchObject({ status: "failed", statusReason: "You cancelled the payment." });
    expect(valueOf(backend.cancelPayment(payment.id))).toEqual(cancelled);
    expect(backend.cancelPayment("pay_missing")).toMatchObject({ error: { code: "not_found" } });
  });

  it("refuses to cancel once the buyer has approved, or once it's over", () => {
    const { backend, clock } = createTestBackend();
    const order = openOrder(backend);
    const { payment } = valueOf(backend.createPayment(order.id, UPI));
    valueOf(backend.respondInUpiApp(payment.id, "approve"));
    expect(backend.cancelPayment(payment.id)).toMatchObject({
      error: {
        code: "invalid_state",
        detail: "That payment has been approved and is being processed, so it can’t be cancelled.",
      },
    });
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(backend.cancelPayment(payment.id)).toMatchObject({
      error: { code: "invalid_state", detail: "That payment is already over." },
    });
  });

  it("keeps each method's answers to itself", () => {
    const { backend } = createTestBackend();
    const order = openOrder(backend);
    const { payment: upi } = valueOf(backend.createPayment(order.id, UPI));
    expect(backend.confirmChallenge(upi.id, "approve")).toMatchObject({ error: { code: "invalid_state" } });
    valueOf(backend.cancelPayment(upi.id));

    const { payment: card } = valueOf(backend.createPayment(order.id, testCard(TEST_CARDS.challenge)));
    expect(backend.respondInUpiApp(card.id, "approve")).toMatchObject({ error: { code: "invalid_state" } });
    expect(backend.respondInUpiApp("pay_missing", "approve")).toMatchObject({ error: { code: "not_found" } });
  });

  it("takes UPI in rupees only", () => {
    const { backend } = createTestBackend();
    const order = openOrder(backend);
    const stored = backend.getState().orders[order.id];
    if (stored) stored.amounts.currency = "USD";
    expect(backend.createPayment(order.id, UPI)).toMatchObject({
      ok: false,
      error: { code: "invalid_request", detail: "UPI can only pay in rupees." },
    });
  });

  it("shows the phone the newest request still waiting", () => {
    const { backend, clock } = createTestBackend();
    const first = valueOf(backend.createPayment(openOrder(backend).id, UPI)).payment;
    clock.advance(1_000);
    const second = valueOf(backend.createPayment(openOrder(backend).id, UPI)).payment;
    expect(backend.getPendingUpiRequest()?.paymentId).toBe(second.id);
    valueOf(backend.cancelPayment(second.id));
    expect(backend.getPendingUpiRequest()?.paymentId).toBe(first.id);
  });
});
