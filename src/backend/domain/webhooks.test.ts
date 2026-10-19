// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, testAttendees, valueOf } from "@/backend/testing/fixtures";
import { LAST_SECONDS_MS } from "./payments";
import { DUPLICATE_GAP_MS } from "./webhooks";

describe("webhooks", () => {
  it("fulfils the order only when the webhook arrives, not when the payment is accepted", () => {
    const { backend, clock } = createTestBackend();
    const { order, payment } = purchase(backend, { quantity: 2 });
    expect(valueOf(payment).payment.status).toBe("processing");
    expect(valueOf(backend.getOrder(order.id)).status).toBe("pending");
    clock.advance(DEFAULT_CHAOS.webhookDelayMs - 1);
    expect(backend.deliverDue()).toBe(0);
    clock.advance(1);
    expect(backend.deliverDue()).toBe(1);
    const fulfilled = valueOf(backend.getOrder(order.id));
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.tickets).toHaveLength(2);
    expect(backend.available("osc-session")).toBe(9 - 2); // converted to sales, no double count
  });

  it("processes a duplicate delivery once", () => {
    const { backend, clock } = createTestBackend("webhook-twice");
    const { order } = purchase(backend, { quantity: 1 });
    clock.advance(DEFAULT_CHAOS.webhookDelayMs + DUPLICATE_GAP_MS);
    expect(backend.deliverDue()).toBe(2);
    const fulfilled = valueOf(backend.getOrder(order.id));
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.tickets).toHaveLength(1);
    expect(backend.getState().log.some((entry) => entry.message.includes("already processed, ignored"))).toBe(true);
  });

  it("can complete the order before the browser even hears back", () => {
    const { backend } = createTestBackend("webhook-first");
    const { order } = purchase(backend, { quantity: 1 });
    expect(backend.nextDeliveryAtMs()).toBe(order.createdAtMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("refunds a payment that lands after the hold expired", () => {
    const { backend, clock } = createTestBackend("hold-expires");
    const { hold, order, payment } = purchase(backend, { quantity: 1 });
    const paymentId = valueOf(payment).payment.id;
    expect(backend.getState().holds[hold.id]?.expiresAtMs).toBe(
      (backend.getState().payments[paymentId]?.createdAtMs ?? 0) + LAST_SECONDS_MS,
    );
    clock.advance(LAST_SECONDS_MS);
    expect(valueOf(backend.getOrder(order.id)).status).toBe("pending"); // the payment in flight protects it
    clock.advance(6_000);
    backend.deliverDue();
    const refunded = valueOf(backend.getOrder(order.id));
    expect(refunded.status).toBe("refunded");
    expect(refunded.statusReason).toMatch(/refunded it in full/);
    expect(refunded.payment?.status).toBe("refunded");
    expect(backend.available("osc-session")).toBe(9); // nothing was sold
  });

  it("ignores a webhook for an order that's already settled", () => {
    const { backend, clock } = createTestBackend();
    const { order, payment } = purchase(backend, { quantity: 1 });
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    backend.getState().outbox.push({
      deliveryId: "dlv_late",
      eventId: "evt_new",
      type: "payment.succeeded",
      paymentId: valueOf(payment).payment.id,
      enqueuedAtMs: clock.now(),
      deliverAtMs: clock.now(),
    });
    expect(() => backend.deliverDue()).not.toThrow();
    expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  });

  describe("payment.failed", () => {
    function requestUpi(backend: ReturnType<typeof createTestBackend>["backend"]) {
      const { hold } = valueOf(
        backend.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] }),
      );
      const { order } = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(1), addOns: {} }));
      return { order, payment: valueOf(backend.createPayment(order.id, { method: "upi" })).payment };
    }

    it("fails the order once, however many times it arrives", () => {
      const { backend, clock } = createTestBackend("webhook-twice");
      const { order, payment } = requestUpi(backend);
      valueOf(backend.respondInUpiApp(payment.id, "decline"));
      clock.advance(DEFAULT_CHAOS.webhookDelayMs + DUPLICATE_GAP_MS);
      expect(backend.deliverDue()).toBe(2);
      expect(valueOf(backend.getOrder(order.id))).toMatchObject({
        status: "failed",
        payment: { status: "failed", failureCode: "upi_declined" },
      });
      expect(backend.getState().log.some((entry) => entry.message.startsWith("payment.failed evt_"))).toBe(true);
      expect(backend.getState().log.some((entry) => entry.message.includes("already processed, ignored"))).toBe(true);
    });

    it("ignores one for a payment that's no longer being processed", () => {
      const { backend, clock } = createTestBackend();
      const { order, payment } = requestUpi(backend);
      valueOf(backend.cancelPayment(payment.id));
      backend.getState().outbox.push({
        deliveryId: "dlv_stale",
        eventId: "evt_stale",
        type: "payment.failed",
        failureCode: "upi_declined",
        paymentId: payment.id,
        enqueuedAtMs: clock.now(),
        deliverAtMs: clock.now(),
      });
      backend.deliverDue();
      expect(valueOf(backend.getOrder(order.id)).payment).toMatchObject({ status: "failed", failureCode: "cancelled" });
      expect(backend.getState().log.at(-1)?.message).toBe(
        `payment.failed for ${payment.id}, which is already failed; ignored.`,
      );
    });
  });
});
