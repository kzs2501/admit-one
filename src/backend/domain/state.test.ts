// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createBackend } from "@/backend/backend";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { createTestBackend, purchase, valueOf } from "@/backend/testing/fixtures";
import { createInitialState, deserializeState, serializeState } from "./state";

describe("persisted state", () => {
  it("survives a reload mid-payment, including the webhook still in the outbox", () => {
    const { backend, clock } = createTestBackend();
    const { order } = purchase(backend, { quantity: 1 });
    const restoredState = deserializeState(serializeState(backend.getState()));
    expect(restoredState).not.toBeNull();

    const restored = createBackend(
      { now: clock.now, newId: (prefix) => `${prefix}_restored`, random: () => 0.1 },
      restoredState ?? createInitialState(),
    );
    expect(restored.nextDeliveryAtMs()).not.toBeNull();
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    restored.deliverDue();
    expect(valueOf(restored.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("starts fresh from unreadable, foreign or older storage", () => {
    expect(deserializeState(null)).toBeNull();
    expect(deserializeState("{not json")).toBeNull();
    expect(deserializeState(JSON.stringify({ version: 9 }))).toBeNull();
    expect(deserializeState(JSON.stringify({ ...createInitialState(), version: 1 }))).toBeNull();
    expect(deserializeState(JSON.stringify({ ...createInitialState(), holds: { h: { id: 1 } } }))).toBeNull();
  });

  it("resets to an empty sandbox, keeping the chosen preset", () => {
    const { backend } = createTestBackend("crowd");
    purchase(backend, { quantity: 1, eventSlug: "frontend-systems-summit", tierId: "fss-general" });
    backend.reset();
    expect(backend.getState().presetId).toBe("crowd");
    expect(Object.keys(backend.getState().holds)).toHaveLength(0);
  });
});
