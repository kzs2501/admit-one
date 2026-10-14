// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, testAttendees, testCard, valueOf } from "@/backend/testing/fixtures";
import type { UpsertOrderCommand } from "./orders";

const summitHold = (backend: ReturnType<typeof createTestBackend>["backend"]) =>
  valueOf(backend.createHold({ eventSlug: "frontend-systems-summit", items: [{ tierId: "fss-general", quantity: 2 }] }))
    .hold;

describe("orders", () => {
  it("creates one order per hold and updates it on resubmit", () => {
    const { backend } = createTestBackend();
    const hold = summitHold(backend);
    const first = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(2), addOns: {} }));
    const second = valueOf(
      backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(2), addOns: { "fss-lunch": 2 } }),
    );
    expect(first.isCreated).toBe(true);
    expect(second.isCreated).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.amounts).toEqual({
      currency: "INR",
      ticketsMinor: 999800,
      addOnsMinor: 90000,
      feesMinor: 32694,
      totalMinor: 1122494,
    });
  });

  it("requires one attendee per ticket, and known add-ons", () => {
    const { backend } = createTestBackend();
    const hold = summitHold(backend);
    const attempts: UpsertOrderCommand[] = [
      { holdId: hold.id, attendees: testAttendees(1), addOns: {} },
      { holdId: hold.id, attendees: testAttendees(2), addOns: { "fss-lunch": 3 } },
      { holdId: hold.id, attendees: testAttendees(2), addOns: { nope: 1 } },
    ];
    for (const attempt of attempts) {
      expect(backend.upsertOrder(attempt)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    }
  });

  it("derives expiry on read without writing, and settles it on the next write", () => {
    const { backend, clock } = createTestBackend();
    const { hold } = valueOf(
      backend.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] }),
    );
    const { order } = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(1), addOns: {} }));
    clock.advance(DEFAULT_CHAOS.holdSeconds * 1000);
    expect(valueOf(backend.getOrder(order.id)).status).toBe("expired");
    expect(backend.getState().orders[order.id]?.status).toBe("pending"); // the read didn't write
    expect(backend.createPayment(order.id, testCard())).toMatchObject({ ok: false, error: { code: "hold_expired" } });
    expect(backend.getState().orders[order.id]?.status).toBe("expired"); // the write path settled it
  });
});
