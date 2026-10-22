// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/core/catalog";
import { generateHistory, getHistory, HISTORY_DAYS } from "./history";

describe("order history", () => {
  const history = getHistory();

  it("is the same every time it's generated", () => {
    const again = generateHistory();
    expect(again.orders).toHaveLength(history.orders.length);
    expect(again.orders.at(1234)).toEqual(history.orders.at(1234));
  });

  it("agrees with the catalogue: fulfilled tickets are exactly each tier's baseline", () => {
    for (const event of CATALOG) {
      for (const tier of event.tiers) {
        const sold = history.orders
          .filter((order) => order.tierId === tier.id && order.status === "fulfilled")
          .reduce((sum, order) => sum + order.quantity, 0);
        expect(sold, tier.id).toBe(tier.baselineSold);
      }
    }
  });

  it("sells a seated hall's sold seats, each once, and no others", () => {
    const monsoon = CATALOG.find((event) => event.slug === "monsoon-strings");
    if (monsoon?.seating.kind !== "reserved") throw new Error("monsoon-strings should be seated");
    const seatIds = history.orders.filter((order) => order.status === "fulfilled").flatMap((order) => order.seatIds);
    expect(new Set(seatIds).size).toBe(seatIds.length);
    expect(new Set(seatIds)).toEqual(monsoon.seating.baselineSoldSeatIds);
  });

  it("numbers about nine thousand orders oldest first, all within the last 30 days", () => {
    expect(history.orders.length).toBeGreaterThan(8_000);
    expect(history.orders[0]?.id).toBe("ord_h00001");
    const ages = history.orders.map((order) => order.agoMs);
    expect(ages).toEqual([...ages].sort((older, newer) => newer - older));
    expect(Math.max(...ages)).toBeLessThan(HISTORY_DAYS * 24 * 60 * 60_000);
  });

  it("has a webhook lag only for orders that were paid", () => {
    for (const order of history.orders.slice(0, 500)) {
      const isPaid = order.status === "fulfilled" || order.status === "refunded";
      expect(order.webhookLagMs !== null, order.id).toBe(isPaid);
    }
  });

  it("is quick enough to generate on an organiser's first request", () => {
    // The fastest of a few runs: that's the code's own time, without a garbage collection
    // or a busy, throttled machine in it. The budget catches the code getting several
    // times slower, not a slow afternoon (and it runs under coverage, which slows it).
    const runs = Array.from({ length: 3 }, () => {
      const startedAt = performance.now();
      generateHistory();
      return performance.now() - startedAt;
    });
    expect(Math.min(...runs)).toBeLessThan(500);
  });
});
