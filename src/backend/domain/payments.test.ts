// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, testAttendees, testCard, valueOf } from "@/backend/testing/fixtures";
import { PAYMENT_GRACE_MS, TEST_CARDS } from "./payments";

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
