// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAOS } from "@/backend/chaos/presets";
import { CATALOG } from "@/core/catalog";
import {
  createTestBackend,
  freeSeatRun,
  gapMakingSelection,
  SEATED_EVENT,
  seatedPlan,
  testAttendees,
  testCard,
  valueOf,
} from "@/backend/testing/fixtures";

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
    clock.advance(DEFAULT_CHAOS.holdDurationMs - 1);
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

  it("crowd ticks buy one ticket at a time, and only from tiers with plenty left", () => {
    const { backend } = createTestBackend("crowd");
    const tierIds = CATALOG.flatMap((event) => event.tiers.map((tier) => tier.id));
    const before = new Map(tierIds.map((tierId) => [tierId, backend.available(tierId)]));
    expect(backend.runCrowdTick()).toBe(true);
    const bought = tierIds.filter((tierId) => backend.available(tierId) !== before.get(tierId));
    expect(bought).toHaveLength(1);
    const [tierId] = bought;
    expect(backend.available(tierId ?? "")).toBe((before.get(tierId ?? "") ?? 0) - 1);
    expect(before.get(tierId ?? "")).toBeGreaterThan(3); // never one that's nearly gone
    expect(backend.available("nmj-standing")).toBe(2);
  });
});

describe("reserved seating", () => {
  const seats = (seatIds: string[]) => ({ eventSlug: SEATED_EVENT, seatIds });
  const unavailable = (backend: ReturnType<typeof createTestBackend>["backend"]) =>
    new Set(valueOf(backend.getSeatAvailability(SEATED_EVENT)).unavailableSeatIds);

  it("holds the chosen seats, and counts them by tier", () => {
    const { backend } = createTestBackend();
    const chosen = freeSeatRun(backend, 2, "ms-premium");
    const premiumBefore = backend.available("ms-premium");
    const { hold } = valueOf(backend.createHold(seats(chosen)));
    expect(hold.seats.map((seat) => seat.id)).toEqual(chosen);
    expect(hold.items).toEqual([{ tierId: "ms-premium", quantity: 2 }]);
    expect(backend.available("ms-premium")).toBe(premiumBefore - 2);
    for (const seatId of chosen) expect(unavailable(backend).has(seatId)).toBe(true);
  });

  it("holds all of the seats or none of them", () => {
    const { backend } = createTestBackend();
    const [first, second, third] = freeSeatRun(backend, 3);
    if (!first || !second || !third) throw new Error("expected three seats");
    backend.getState().soldSeatIds.push(second); // another buyer got the middle one
    const result = backend.createHold(seats([first, second, third]));
    expect(result).toMatchObject({ ok: false, error: { code: "seats_unavailable", seatIds: [second] } });
    expect(unavailable(backend).has(first)).toBe(false);
    expect(Object.keys(backend.getState().holds)).toHaveLength(0);
  });

  it("refuses a selection that strands a single seat, and names the seat", () => {
    const { backend } = createTestBackend();
    const { seatIds, stranded } = gapMakingSelection(backend);
    const result = backend.createHold(seats(seatIds));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("single_seat_gap");
    expect(result.error).toHaveProperty("seatIds", expect.arrayContaining([stranded.id]));
  });

  it("frees a hold's seats the moment it expires, without anything running", () => {
    const { backend, clock } = createTestBackend();
    const chosen = freeSeatRun(backend, 2);
    valueOf(backend.createHold(seats(chosen)));
    clock.advance(DEFAULT_CHAOS.holdDurationMs);
    for (const seatId of chosen) expect(unavailable(backend).has(seatId)).toBe(false);
  });

  it("chooses the best seats together when asked by tier", () => {
    const { backend } = createTestBackend();
    const { hold } = valueOf(
      backend.createHold({ eventSlug: SEATED_EVENT, items: [{ tierId: "ms-stalls", quantity: 4 }] }),
    );
    expect(hold.seats).toHaveLength(4);
    const [first] = hold.seats;
    expect(hold.seats.every((seat) => seat.row === first?.row && seat.tierId === "ms-stalls")).toBe(true);
    const numbers = hold.seats.map((seat) => seat.number);
    expect(numbers).toEqual(numbers.map((_, i) => (numbers[0] ?? 0) + i));
  });

  it("says a tier is sold out when it has fewer free seats than asked for", () => {
    const { backend } = createTestBackend();
    // Every Premium seat sells except one.
    const [lastFree] = freeSeatRun(backend, 1, "ms-premium");
    const premium = seatedPlan().seats.filter((seat) => seat.tierId === "ms-premium" && seat.id !== lastFree);
    backend.getState().soldSeatIds.push(...premium.map((seat) => seat.id));
    expect(
      backend.createHold({ eventSlug: SEATED_EVENT, items: [{ tierId: "ms-premium", quantity: 2 }] }),
    ).toMatchObject({ ok: false, error: { code: "sold_out", tierId: "ms-premium", available: 1 } });
  });

  it("rejects seats for an event without them, and seats that aren't in the hall", () => {
    const { backend } = createTestBackend();
    expect(backend.createHold({ eventSlug: "open-studio-ceramics", seatIds: ["stalls-A-1"] })).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(backend.createHold(seats(["stalls-Z-99"]))).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("sells the seats when the payment's webhook arrives, and prints one on each ticket", () => {
    const { backend, clock } = createTestBackend();
    const chosen = freeSeatRun(backend, 2);
    const { hold } = valueOf(backend.createHold(seats(chosen)));
    const { order } = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(2), addOns: {} }));
    valueOf(backend.createPayment(order.id, testCard()));
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    backend.deliverDue();

    const fulfilled = valueOf(backend.getOrder(order.id));
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.tickets.map((ticket) => ticket.seat?.id)).toEqual(chosen);
    expect(backend.getState().soldSeatIds).toEqual(chosen);
    // Converted, so the seats are gone for good — and counted once.
    clock.advance(DEFAULT_CHAOS.holdDurationMs);
    for (const seatId of chosen) expect(unavailable(backend).has(seatId)).toBe(true);
  });

  it("lets the crowd snatch one requested seat, once, so the next try can succeed", () => {
    const { backend } = createTestBackend("seat-snatched");
    const chosen = freeSeatRun(backend, 2);
    const result = backend.createHold(seats(chosen));
    expect(result).toMatchObject({ ok: false, error: { code: "seats_unavailable", seatIds: [chosen.at(-1)] } });
    expect(backend.getState().log.at(-1)?.message).toMatch(/Another buyer took .* \(a moment before you\)/);
    valueOf(backend.createHold(seats(freeSeatRun(backend, 2))));
  });

  it("lets the background crowd buy seats", () => {
    const { backend } = createTestBackend("crowd");
    let ticks = 0;
    while (backend.getState().soldSeatIds.length === 0 && ticks < 50) {
      backend.runCrowdTick();
      ticks += 1;
    }
    expect(backend.getState().soldSeatIds.length).toBeGreaterThan(0);
  });
});
