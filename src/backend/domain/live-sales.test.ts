// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, valueOf } from "@/backend/testing/fixtures";
import { findTier } from "@/core/catalog";
import { DEMO_ACCOUNTS } from "@/core/organisations";
import { DEFAULT_ORDER_BY, DEFAULT_PAGE_SIZE } from "@/contract/queries";
import { otherBuyer } from "./history";
import { LIVE_SALES_LIMIT } from "./inventory";

/** One background sale, and the owner of the event it was for. */
function oneLiveSale() {
  const { backend, clock } = createTestBackend("busy-on-sale");
  expect(backend.runCrowdTick()).toBe(true);
  const [sale] = backend.getState().liveSales;
  if (!sale) throw new Error("The crowd should have bought something");
  const event = findTier(sale.tierId)?.event;
  const owner = DEMO_ACCOUNTS.find(
    (account) => account.role === "owner" && account.organisationId === event?.organiserId,
  );
  if (!event || !owner) throw new Error("The sale should belong to an organiser");
  return { backend, clock, sale, event, owner };
}

describe("other buyers' sales", () => {
  it("shows the crowd's sale to its organiser as a fulfilled order, from the same buyer every time", () => {
    const { backend, sale, owner } = oneLiveSale();
    const order = valueOf(backend.getOrganiserOrder(owner, "ord_l00001"));
    expect(order).toMatchObject({ status: "fulfilled", ticketCount: sale.quantity, buyerName: otherBuyer(1).name });
    expect(otherBuyer(1)).toEqual(otherBuyer(1));
    const newest = valueOf(
      backend.listOrders(owner, { status: [], orderBy: DEFAULT_ORDER_BY, pageSize: DEFAULT_PAGE_SIZE }),
    ).orders[0];
    expect(newest?.id).toBe("ord_l00001");
  });

  it("records the crowd's general-admission sales too, such as the last tickets taken a moment first", () => {
    const { backend } = createTestBackend("crowd");
    expect(
      backend.createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", quantity: 1 }] }).ok,
    ).toBe(false);
    expect(backend.getState().liveSales).toMatchObject([{ seq: 1, tierId: "nmj-standing", quantity: 2, seatIds: [] }]);
  });

  it("counts in the metrics, and its tickets go back on sale if it's refunded", () => {
    const { backend, clock, sale, event, owner } = oneLiveSale();
    const metrics = valueOf(backend.salesMetrics(owner, event.slug));
    expect(metrics.tickets.sold).toBe(metrics.tiers.reduce((sum, tier) => sum + tier.sold, 0));
    const availableBefore = backend.available(sale.tierId);

    valueOf(backend.requestRefund(owner, "ord_l00001", "requested_by_customer"));
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();
    expect(valueOf(backend.getOrganiserOrder(owner, "ord_l00001")).status).toBe("refunded");
    expect(backend.available(sale.tierId)).toBe(availableBefore + sale.quantity);
  });

  it("stops buying at the limit, so a long session can't fill the sandbox's storage", () => {
    const { backend } = createTestBackend("busy-on-sale");
    const { liveSales } = backend.getState();
    for (let seq = 1; seq <= LIVE_SALES_LIMIT; seq++)
      liveSales.push({ seq, tierId: "llf-day", quantity: 1, seatIds: [], atMs: 0 });
    expect(backend.runCrowdTick()).toBe(false);
  });

  it("buys every second and a half in the busy on-sale scenario", () => {
    const { backend } = createTestBackend("busy-on-sale");
    expect(backend.chaos()).toMatchObject({ isCrowdEnabled: true, crowdIntervalMs: 1_500 });
  });
});
