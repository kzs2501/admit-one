// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "@/core/statuses";
import { canTransition, isTerminal, ORDER_TRANSITIONS } from "./order-machine";

describe("order state machine", () => {
  const legal = new Set([
    "pending>paid",
    "pending>failed",
    "pending>expired",
    "failed>pending",
    "failed>expired",
    "paid>fulfilled",
    "paid>refunded",
    "fulfilled>refunded",
  ]);

  it("allows exactly the documented ORDER_TRANSITIONS", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it("treats refunded and expired as terminal — a fulfilled order can still be refunded", () => {
    expect(ORDER_STATUSES.filter(isTerminal).sort()).toEqual(["expired", "refunded"]);
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });
});
