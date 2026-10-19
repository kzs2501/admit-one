// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, valueOf } from "@/backend/testing/fixtures";
import { findAccount, type Account } from "@/core/organisations";
import { DUPLICATE_GAP_MS } from "./webhooks";
import { getHistory } from "./history";

const account = (id: string): Account => {
  const found = findAccount(id);
  if (!found) throw new Error(`No demo account ${id}`);
  return found;
};
const rangmanchOwner = account("acc-rangmanch-owner");

type Backend = ReturnType<typeof createTestBackend>["backend"];
type Clock = ReturnType<typeof createTestBackend>["clock"];

function settle(backend: Backend, clock: Clock) {
  clock.advance(DEFAULT_CHAOS.webhookDelayMs + DUPLICATE_GAP_MS);
  return backend.deliverDue();
}

/** A sandbox order for the ceramics session, paid and fulfilled. */
function fulfilledOrder(backend: Backend, clock: Clock, quantity = 2) {
  const { order } = purchase(backend, { quantity });
  settle(backend, clock);
  expect(valueOf(backend.getOrder(order.id)).status).toBe("fulfilled");
  return order;
}

describe("refunds", () => {
  it("refunds a fulfilled order once the webhook arrives: tickets void, and back on sale", () => {
    const { backend, clock } = createTestBackend();
    const order = fulfilledOrder(backend, clock);
    const availableBefore = backend.available("osc-session");

    const { refund, order: pending } = valueOf(
      backend.requestRefund(rangmanchOwner, order.id, "requested_by_customer"),
    );
    expect(refund).toMatchObject({
      status: "pending",
      amountMinor: order.amounts.totalMinor,
      reason: "requested_by_customer",
    });
    expect(pending).toMatchObject({ status: "fulfilled", refundStatus: "pending" });

    settle(backend, clock);
    expect(valueOf(backend.getOrganiserOrder(rangmanchOwner, order.id))).toMatchObject({
      status: "refunded",
      refundStatus: "succeeded",
      refunds: [{ id: refund.id, status: "succeeded" }],
    });
    expect(valueOf(backend.getOrder(order.id))).toMatchObject({
      status: "refunded",
      statusReason: "The organiser refunded this order in full.",
      tickets: [],
      payment: { status: "refunded" },
    });
    expect(backend.available("osc-session")).toBe(availableBefore + 2);
  });

  it("refunds an order from the history, putting its seats back on sale", () => {
    const { backend, clock } = createTestBackend();
    const seated = getHistory().orders.find((order) => order.status === "fulfilled" && order.seatIds.length > 0);
    if (!seated) throw new Error("The history should have a seated order");
    const before = valueOf(backend.salesMetrics(rangmanchOwner, "monsoon-strings"));
    const availableBefore = backend.available(seated.tierId);

    valueOf(backend.requestRefund(rangmanchOwner, seated.id, "event_changed"));
    settle(backend, clock);

    const free = valueOf(backend.getSeatAvailability("monsoon-strings")).unavailableSeatIds;
    for (const seatId of seated.seatIds) expect(free).not.toContain(seatId);
    expect(backend.available(seated.tierId)).toBe(availableBefore + seated.quantity);
    const after = valueOf(backend.salesMetrics(rangmanchOwner, "monsoon-strings"));
    expect(after.revenue.refundedMinor).toBe(before.revenue.refundedMinor + seated.amounts.totalMinor);
    expect(after.tickets.sold).toBe(before.tickets.sold - seated.quantity);
  });

  it("refunds a general-admission order from the history, putting its tickets back on sale", () => {
    const { backend, clock } = createTestBackend();
    const lakesideOwner = account("acc-lakeside-owner");
    const festivalOrder = getHistory().orders.find(
      (order) => order.eventSlug === "lakeside-lights" && order.status === "fulfilled",
    );
    if (!festivalOrder) throw new Error("The history should have a festival order");
    const availableBefore = backend.available(festivalOrder.tierId);
    const soldBefore = valueOf(backend.salesMetrics(lakesideOwner, "lakeside-lights")).tickets.sold;

    valueOf(backend.requestRefund(lakesideOwner, festivalOrder.id, "requested_by_customer"));
    settle(backend, clock);
    expect(backend.available(festivalOrder.tierId)).toBe(availableBefore + festivalOrder.quantity);
    expect(valueOf(backend.salesMetrics(lakesideOwner, "lakeside-lights")).tickets.sold).toBe(
      soldBefore - festivalOrder.quantity,
    );
  });

  it("refuses a second refund, an order that isn't fulfilled, and anyone without the permission", () => {
    const { backend, clock } = createTestBackend();
    const order = fulfilledOrder(backend, clock, 1);
    valueOf(backend.requestRefund(rangmanchOwner, order.id, "duplicate"));
    expect(backend.requestRefund(rangmanchOwner, order.id, "duplicate")).toMatchObject({
      error: { code: "invalid_state", detail: "A refund for this order is already on its way." },
    });
    settle(backend, clock);
    expect(backend.requestRefund(rangmanchOwner, order.id, "duplicate")).toMatchObject({
      error: { code: "invalid_state", detail: "This order has already been refunded." },
    });

    const unpaid = getHistory().orders.find(
      (entry) => entry.status === "failed" && entry.eventSlug === "lakeside-lights",
    );
    expect(backend.requestRefund(account("acc-lakeside-owner"), unpaid?.id ?? "", "other")).toMatchObject({
      error: { code: "invalid_state", detail: "Only fulfilled orders can be refunded." },
    });
    const festivalOrder = getHistory().orders.find(
      (entry) => entry.status === "fulfilled" && entry.eventSlug === "lakeside-lights",
    );
    expect(backend.requestRefund(account("acc-lakeside-box-office"), festivalOrder?.id ?? "", "other")).toMatchObject({
      error: { code: "forbidden" },
    });
    expect(backend.requestRefund(rangmanchOwner, festivalOrder?.id ?? "", "other")).toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("changes nothing when the provider refuses to start a refund", () => {
    const { backend, clock } = createTestBackend();
    const order = fulfilledOrder(backend, clock, 1);
    backend.setPreset("refunds-fail");
    expect(backend.requestRefund(rangmanchOwner, order.id, "other")).toMatchObject({
      error: { code: "refund_failed" },
    });
    expect(Object.keys(backend.getState().refunds)).toHaveLength(0);
    expect(backend.getState().outbox).toHaveLength(0);
  });

  it("returns the tickets once, however many times the webhook arrives", () => {
    const { backend, clock } = createTestBackend("webhook-twice");
    const order = fulfilledOrder(backend, clock, 2);
    const availableBefore = backend.available("osc-session");
    valueOf(backend.requestRefund(rangmanchOwner, order.id, "other"));
    expect(settle(backend, clock)).toBe(2);
    expect(backend.available("osc-session")).toBe(availableBefore + 2);
  });
});
