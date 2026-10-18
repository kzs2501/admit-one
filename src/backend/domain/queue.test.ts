// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend, valueOf } from "@/backend/testing/fixtures";

const EVENT = "open-studio-ceramics";
const hold = (queueToken: string | null) => ({
  eventSlug: EVENT,
  items: [{ tierId: "osc-session", quantity: 1 }],
  queueToken,
});

describe("waiting room", () => {
  it("puts you behind everyone already waiting, and moves the line a batch at a time", () => {
    const { backend, clock } = createTestBackend("flash-sale"); // 40,000 ahead, 8,000 every 2 s
    const { entry } = valueOf(backend.joinQueue(EVENT));
    expect(entry).toMatchObject({ status: "waiting", aheadCount: 40_000, estimatedWaitMs: 10_000 });
    expect(entry.checkAgainAfterMs).toBe(2_000);

    clock.advance(2_000);
    expect(valueOf(backend.getQueueEntry(entry.token))).toMatchObject({ aheadCount: 32_000, estimatedWaitMs: 8_000 });
    clock.advance(7_999);
    expect(valueOf(backend.getQueueEntry(entry.token))).toMatchObject({ status: "waiting", aheadCount: 8_000 });
  });

  it("lets you in at the exact moment the line reaches you, for the admission window, and no longer", () => {
    const { backend, clock } = createTestBackend("flash-sale");
    const { entry } = valueOf(backend.joinQueue(EVENT));
    clock.advance(10_000);
    const admitted = valueOf(backend.getQueueEntry(entry.token));
    expect(admitted).toMatchObject({ status: "admitted", aheadCount: 0 });
    expect(admitted.admittedUntilMs).toBe(admitted.serverTimeMs + 10 * 60_000);

    clock.advance(10 * 60_000 - 1);
    expect(valueOf(backend.getQueueEntry(entry.token)).status).toBe("admitted");
    clock.advance(1);
    expect(valueOf(backend.getQueueEntry(entry.token))).toMatchObject({ status: "expired", checkAgainAfterMs: 0 });
  });

  it("gives one visitor one place: joining again returns it, until it's expired", () => {
    const { backend, clock } = createTestBackend("flash-sale");
    const first = valueOf(backend.joinQueue(EVENT));
    clock.advance(3_000);
    const again = valueOf(backend.joinQueue(EVENT));
    expect(first.isNew).toBe(true);
    expect(again).toMatchObject({ isNew: false, entry: { token: first.entry.token, aheadCount: 32_000 } });

    clock.advance(10 * 60_000 + 10_000);
    const fresh = valueOf(backend.joinQueue(EVENT));
    expect(fresh.isNew).toBe(true);
    expect(fresh.entry.token).not.toBe(first.entry.token);
  });

  it("keeps a place's pace even if the scenario changes mid-queue", () => {
    const { backend, clock } = createTestBackend("flash-sale");
    const { entry } = valueOf(backend.joinQueue(EVENT));
    backend.setPreset("happy");
    clock.advance(4_000);
    expect(valueOf(backend.getQueueEntry(entry.token)).aheadCount).toBe(24_000);
  });

  it("has nothing to join when there's no waiting room, and lets everyone reserve", () => {
    const { backend } = createTestBackend();
    expect(backend.joinQueue(EVENT)).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(backend.createHold(hold(null)).ok).toBe(true);
  });

  it("lets only a place whose turn has come reserve — for this sale, and only while it lasts", () => {
    const { backend, clock } = createTestBackend("flash-sale");
    const required = { ok: false, error: { code: "queue_required", eventSlug: EVENT } };
    expect(backend.createHold(hold(null))).toMatchObject(required);
    expect(backend.createHold(hold("q_made_up"))).toMatchObject(required);

    const { entry } = valueOf(backend.joinQueue(EVENT));
    const notYet = backend.createHold(hold(entry.token));
    expect(notYet).toMatchObject(required);
    expect(notYet.ok ? "" : notYet.error.detail).toMatch(/isn’t your turn yet/);
    const otherSale = valueOf(backend.joinQueue("night-market-jazz")).entry;

    clock.advance(10_000);
    expect(backend.createHold(hold(otherSale.token))).toMatchObject(required); // another sale's place
    expect(backend.createHold(hold(entry.token)).ok).toBe(true);

    clock.advance(10 * 60_000);
    const tooLate = backend.createHold(hold(entry.token));
    expect(tooLate).toMatchObject(required);
    expect(tooLate.ok ? "" : tooLate.error.detail).toMatch(/turn has passed/);
  });
});
