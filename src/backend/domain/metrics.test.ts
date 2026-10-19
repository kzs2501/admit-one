// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, START_MS, valueOf } from "@/backend/testing/fixtures";
import { findAccount, type Account } from "@/core/organisations";
import { percentile } from "./metrics";

const account = (id: string): Account => {
  const found = findAccount(id);
  if (!found) throw new Error(`No demo account ${id}`);
  return found;
};

describe("percentile", () => {
  it("returns one of the values, by nearest rank", () => {
    const tenValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(tenValues, 50)).toBe(5);
    expect(percentile(tenValues, 95)).toBe(10);
    expect(percentile(tenValues, 0)).toBe(1);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("sales metrics", () => {
  it("counts tickets the way the event page does: sold is capacity less what's left", () => {
    const { backend } = createTestBackend();
    const metrics = valueOf(backend.salesMetrics(account("acc-lakeside-owner"), "lakeside-lights"));
    for (const tier of metrics.tiers)
      expect(tier.sold, tier.tierId).toBe(tier.capacity - backend.available(tier.tierId));
    expect(metrics.tickets.sold).toBe(8_400 + 4_550 + 360);
  });

  it("splits sales into the organisation's calendar days, quiet ones included, up to today", () => {
    const { backend } = createTestBackend();
    const { salesByDay, paidOrders, revenue } = valueOf(backend.salesMetrics(account("acc-lakeside-owner")));
    expect(salesByDay.at(-1)?.date).toBe("2026-10-12"); // START_MS is the afternoon of the 12th in Kolkata
    expect(salesByDay[0]?.date).toBe("2026-09-12");
    expect(salesByDay.reduce((sum, day) => sum + day.revenueMinor, 0)).toBe(revenue.netMinor);
    const { tickets } = valueOf(backend.salesMetrics(account("acc-lakeside-owner")));
    expect(salesByDay.reduce((sum, day) => sum + day.tickets, 0)).toBe(tickets.sold);
    expect(paidOrders).toBeGreaterThan(7_000);
    expect(revenue.netMinor).toBe(revenue.grossMinor - revenue.refundedMinor);
    expect(revenue.refundedMinor).toBeGreaterThan(0);
  });

  it("puts a sale at midnight in Kolkata on the new day there, which is still yesterday in UTC", () => {
    const { backend, clock } = createTestBackend();
    clock.advance(Date.UTC(2026, 9, 12, 18, 30) - START_MS); // 00:00 on the 13th in Kolkata
    purchase(backend, { quantity: 1 });
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    const { salesByDay } = valueOf(backend.salesMetrics(account("acc-rangmanch-owner"), "open-studio-ceramics"));
    expect(salesByDay.at(-1)).toMatchObject({ date: "2026-10-13", tickets: 1 });
  });

  it("has a funnel that only narrows", () => {
    const { backend } = createTestBackend();
    const { funnel } = valueOf(backend.salesMetrics(account("acc-rangmanch-owner")));
    expect(funnel.holds).toBeGreaterThanOrEqual(funnel.orders);
    expect(funnel.orders).toBeGreaterThanOrEqual(funnel.paid);
    expect(funnel.paid).toBeGreaterThanOrEqual(funnel.fulfilled);
    expect(funnel.fulfilled).toBeGreaterThan(0);
  });

  it("adds a sandbox sale to today, and its webhook's lag to the samples", () => {
    const { backend, clock } = createTestBackend();
    const rangmanch = account("acc-rangmanch-owner");
    const before = valueOf(backend.salesMetrics(rangmanch, "open-studio-ceramics"));
    purchase(backend, { quantity: 2 });
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    const after = valueOf(backend.salesMetrics(rangmanch, "open-studio-ceramics"));
    expect(after.paidOrders).toBe(before.paidOrders + 1);
    expect(after.salesByDay.at(-1)?.tickets).toBe((before.salesByDay.at(-1)?.tickets ?? 0) + 2);
    expect(after.webhookLag.samples).toBe(before.webhookLag.samples + 1);
    expect(after.tickets.sold).toBe(before.tickets.sold + 2);
    expect(after.funnel.holds).toBe(before.funnel.holds + 1);
  });

  it("splits payments by method, and reports webhook lag by percentile", () => {
    const { backend } = createTestBackend();
    const { paymentMethods, webhookLag, paidOrders } = valueOf(backend.salesMetrics(account("acc-lakeside-owner")));
    expect(paymentMethods.reduce((sum, entry) => sum + entry.orders, 0)).toBe(paidOrders);
    expect(paymentMethods[0]).toMatchObject({ method: "upi" });
    expect(webhookLag.samples).toBe(paidOrders);
    expect(webhookLag.p50Ms).toBeLessThanOrEqual(webhookLag.p95Ms ?? 0);
  });

  it("is only for the account's own events", () => {
    const { backend } = createTestBackend();
    expect(backend.salesMetrics(account("acc-rangmanch-owner"), "lakeside-lights")).toMatchObject({
      error: { code: "forbidden" },
    });
  });
});
