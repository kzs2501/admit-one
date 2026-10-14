// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, valueOf } from "@/backend/testing/fixtures";

const ceramics = (quantity: number) => ({
  eventSlug: "open-studio-ceramics",
  items: [{ tierId: "osc-session", quantity }],
});
const jazz = (quantity: number) => ({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", quantity }] });

describe("inventory", () => {
  it("counts capacity, baseline sales and live holds", () => {
    const { backend } = createTestBackend();
    expect(backend.available("osc-session")).toBe(12 - 3);
    valueOf(backend.createHold(ceramics(4)));
    expect(backend.available("osc-session")).toBe(5);
  });

  it("releases an expired hold lazily — no timer has to run", () => {
    const { backend, clock } = createTestBackend();
    valueOf(backend.createHold(ceramics(4)));
    clock.advance(DEFAULT_CHAOS.holdSeconds * 1000 - 1);
    expect(backend.available("osc-session")).toBe(5);
    clock.advance(1);
    expect(backend.available("osc-session")).toBe(9);
  });

  it("refuses to oversell, and says how many are left", () => {
    const { backend } = createTestBackend();
    expect(backend.createHold(jazz(3))).toMatchObject({
      ok: false,
      error: { code: "sold_out", tierId: "nmj-standing", available: 2 },
    });
  });

  it("lets exactly one of two buyers take the last tickets", () => {
    const { backend } = createTestBackend();
    expect(backend.createHold(jazz(2)).ok).toBe(true);
    expect(backend.createHold(jazz(1)).ok).toBe(false);
    expect(backend.available("nmj-standing")).toBe(0);
  });

  it("rejects unknown events, and tiers from another event", () => {
    const { backend } = createTestBackend();
    expect(backend.createHold({ eventSlug: "nope", items: [{ tierId: "osc-session", quantity: 1 }] })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      backend.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "nmj-standing", quantity: 1 }] }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("with the crowd on, nearly-sold-out tickets go to someone else first", () => {
    const { backend } = createTestBackend("crowd");
    expect(backend.createHold(jazz(1))).toMatchObject({ ok: false, error: { code: "sold_out", available: 0 } });
    expect(backend.available("nmj-standing")).toBe(0);
    expect(backend.getState().log.some((entry) => entry.kind === "crowd")).toBe(true);
  });

  it("crowd ticks only buy from tiers with plenty left", () => {
    const { backend } = createTestBackend("crowd");
    const before = backend.available("fss-general");
    expect(backend.runCrowdTick()).toBe(true);
    expect(backend.available("nmj-standing")).toBe(2);
    const total = ["fss-general", "fss-workshop", "osc-session"].reduce(
      (sum, tierId) => sum + backend.available(tierId),
      0,
    );
    expect(total).toBe(before + 6 + 9 - 1);
  });
});
