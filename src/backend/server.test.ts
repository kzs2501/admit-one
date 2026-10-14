// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DUPLICATE_GAP_MS, LAST_SECONDS_MS, PAYMENT_GRACE_MS, TEST_CARDS, createServer, type Result } from "./server";
import { DEFAULT_CHAOS, type PresetId } from "@/backend/chaos/presets";
import { canTransition, isTerminal, transitions } from "@/backend/domain/order-machine";
import { deserialize, initialState, serialize } from "@/backend/domain/state";
import type { OrderStatus } from "@/contract/dto";

/** A server on a fake clock with deterministic ids. */
function setup(preset: PresetId = "happy") {
  let t = Date.UTC(2026, 9, 12, 10, 0, 0);
  let n = 0;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  const server = createServer(
    { now: clock.now, newId: (p) => `${p}_${++n}`, random: () => 0.42 },
    initialState(preset),
  );
  return { server, clock };
}

function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Expected ok, got ${r.error.status} ${r.error.code}: ${r.error.message}`);
  return r.value;
}

const card = (number: string = TEST_CARDS.success) => ({ number, expiry: "12 / 30", cvc: "123", name: "Asha Rao" });
const attendees = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Guest ${i + 1}`, email: `guest${i + 1}@example.com` }));

/** Reserve → order → pay, ending with a processing payment. */
function checkout(
  server: ReturnType<typeof setup>["server"],
  qty = 2,
  slug = "open-studio-ceramics",
  tierId = "osc-session",
) {
  const { hold } = value(server.createHold({ eventSlug: slug, items: [{ tierId, qty }] }));
  const order = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(qty), addOns: {} }));
  const paid = server.createPayment(order.id, card(), `key-${hold.id}`);
  return { hold, order, paid };
}

describe("inventory", () => {
  it("counts capacity, baseline sales and live holds", () => {
    const { server } = setup();
    expect(server.available("osc-session")).toBe(12 - 3);
    value(server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 4 }] }));
    expect(server.available("osc-session")).toBe(5);
  });

  it("releases an expired hold lazily — no timer has to run", () => {
    const { server, clock } = setup();
    value(server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 4 }] }));
    clock.advance(DEFAULT_CHAOS.holdSeconds * 1000 - 1);
    expect(server.available("osc-session")).toBe(5);
    clock.advance(1);
    expect(server.available("osc-session")).toBe(9);
  });

  it("refuses to oversell, and says how many are left", () => {
    const { server } = setup();
    const r = server.createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", qty: 3 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ status: 409, code: "sold_out", details: { available: 2 } });
  });

  it("lets exactly one of two buyers take the last tickets", () => {
    const { server } = setup();
    const first = server.createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", qty: 2 }] });
    const second = server.createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", qty: 1 }] });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(server.available("nmj-standing")).toBe(0);
  });

  it("validates requests", () => {
    const { server } = setup();
    expect(server.createHold({ eventSlug: "open-studio-ceramics", items: [] })).toMatchObject({
      ok: false,
      error: { status: 422 },
    });
    expect(server.createHold({ eventSlug: "nope", items: [{ tierId: "osc-session", qty: 1 }] })).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(
      server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "nmj-standing", qty: 1 }] }),
    ).toMatchObject({ ok: false, error: { status: 422 } });
    expect(
      server.createHold({ eventSlug: "frontend-systems-summit", items: [{ tierId: "fss-general", qty: 7 }] }),
    ).toMatchObject({ ok: false, error: { status: 422 } });
  });

  it("with the crowd on, nearly-sold-out tickets go to someone else first", () => {
    const { server } = setup("crowd");
    const r = server.createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", qty: 1 }] });
    expect(r).toMatchObject({ ok: false, error: { code: "sold_out", details: { available: 0 } } });
    expect(server.available("nmj-standing")).toBe(0);
    expect(server.getState().log.some((l) => l.kind === "crowd")).toBe(true);
  });

  it("crowd ticks only buy from tiers with plenty left", () => {
    const { server } = setup("crowd");
    const before = server.available("fss-general");
    expect(server.crowdTick()).toBe(true);
    expect(server.available("nmj-standing")).toBe(2);
    const total = ["fss-general", "fss-workshop", "osc-session"].reduce((s, id) => s + server.available(id), 0);
    expect(total).toBe(before + 6 + 9 - 1);
  });
});

describe("orders", () => {
  it("creates one order per hold and updates it on resubmit", () => {
    const { server } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "frontend-systems-summit", items: [{ tierId: "fss-general", qty: 2 }] }),
    );
    const a = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(2), addOns: {} }));
    const b = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(2), addOns: { "fss-lunch": 2 } }));
    expect(b.id).toBe(a.id);
    expect(b.amounts).toEqual({ ticketsCents: 29800, addOnsCents: 3600, feesCents: 1002, totalCents: 34402 });
  });

  it("requires one attendee per ticket, and known add-ons", () => {
    const { server } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "frontend-systems-summit", items: [{ tierId: "fss-general", qty: 2 }] }),
    );
    expect(server.upsertOrder({ holdId: hold.id, attendees: attendees(1), addOns: {} })).toMatchObject({
      ok: false,
      error: { status: 422 },
    });
    expect(server.upsertOrder({ holdId: hold.id, attendees: attendees(2), addOns: { "fss-lunch": 3 } })).toMatchObject({
      ok: false,
      error: { status: 422 },
    });
    expect(server.upsertOrder({ holdId: hold.id, attendees: attendees(2), addOns: { nope: 1 } })).toMatchObject({
      ok: false,
      error: { status: 422 },
    });
  });

  it("derives expiry on read without writing, and rejects writes once expired", () => {
    const { server, clock } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 1 }] }),
    );
    const order = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(1), addOns: {} }));
    clock.advance(DEFAULT_CHAOS.holdSeconds * 1000);
    expect(value(server.getOrder(order.id)).status).toBe("expired");
    expect(server.getState().orders[order.id].status).toBe("pending"); // the read didn't write
    expect(server.createPayment(order.id, card(), "k1")).toMatchObject({ ok: false, error: { status: 410 } });
    expect(server.getState().orders[order.id].status).toBe("expired"); // the write path settled it
  });
});

describe("order state machine", () => {
  const all: OrderStatus[] = ["pending", "paid", "fulfilled", "failed", "expired", "refunded"];
  const legal = new Set([
    "pending>paid",
    "pending>failed",
    "pending>expired",
    "failed>pending",
    "failed>expired",
    "paid>fulfilled",
    "paid>refunded",
  ]);

  it("allows exactly the documented transitions", () => {
    for (const from of all)
      for (const to of all) expect(canTransition(from, to), `${from} → ${to}`).toBe(legal.has(`${from}>${to}`));
  });

  it("treats fulfilled, refunded and expired as terminal", () => {
    expect(all.filter(isTerminal).sort()).toEqual(["expired", "fulfilled", "refunded"]);
    expect(Object.keys(transitions).sort()).toEqual([...all].sort());
  });
});

describe("payments", () => {
  it("requires an Idempotency-Key", () => {
    const { server } = setup();
    const { order } = checkout(server);
    expect(server.createPayment(order.id, card(), null)).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it("replays the original response for a repeated key — no second charge", () => {
    const { server } = setup();
    const { hold, order, paid } = checkout(server);
    const again = server.createPayment(order.id, card(), `key-${hold.id}`);
    expect(again).toEqual(paid);
    expect(Object.keys(server.getState().payments)).toHaveLength(1);
  });

  it("rejects a reused key for a different request", () => {
    const { server } = setup();
    const { hold, order } = checkout(server);
    expect(server.createPayment(order.id, card(TEST_CARDS.decline), `key-${hold.id}`)).toMatchObject({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
  });

  it("blocks a second payment while one is in flight (double submit with new keys)", () => {
    const { server } = setup();
    const { order } = checkout(server);
    expect(server.createPayment(order.id, card(), "another-key")).toMatchObject({
      ok: false,
      error: { code: "payment_in_progress" },
    });
  });

  it("declines synchronously, fails the order, and allows a retry", () => {
    const { server, clock } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 1 }] }),
    );
    const order = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(1), addOns: {} }));
    expect(server.createPayment(order.id, card(TEST_CARDS.decline), "k1")).toMatchObject({
      ok: false,
      error: { status: 402, code: "card_declined" },
    });
    expect(value(server.getOrder(order.id)).status).toBe("failed");
    expect(server.createPayment(order.id, card(), "k2").ok).toBe(true);
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    server.deliverDue();
    expect(value(server.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("rejects invalid card numbers before charging", () => {
    const { server } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 1 }] }),
    );
    const order = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(1), addOns: {} }));
    expect(server.createPayment(order.id, card("4242424242424241"), "k1")).toMatchObject({
      ok: false,
      error: { status: 422, code: "invalid_card" },
    });
  });

  it("handles the 3-D Secure challenge both ways", () => {
    const { server, clock } = setup();
    const { hold } = value(
      server.createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 1 }] }),
    );
    const order = value(server.upsertOrder({ holdId: hold.id, attendees: attendees(1), addOns: {} }));
    const first = value(server.createPayment(order.id, card(TEST_CARDS.challenge), "k1"));
    expect(first.payment.status).toBe("requires_action");
    expect(server.confirmChallenge(first.payment.id, false)).toMatchObject({
      ok: false,
      error: { code: "authentication_failed" },
    });
    expect(value(server.getOrder(order.id)).status).toBe("failed");

    const second = value(server.createPayment(order.id, card(TEST_CARDS.challenge), "k2"));
    expect(value(server.confirmChallenge(second.payment.id, true)).payment.status).toBe("processing");
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    server.deliverDue();
    expect(value(server.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("extends the hold once when payment starts, so a slow bank doesn't cost the tickets", () => {
    const { server } = setup();
    const { hold } = checkout(server);
    expect(server.getState().holds[hold.id].expiresAt).toBeGreaterThanOrEqual(hold.createdAt + PAYMENT_GRACE_MS);
  });
});

describe("webhooks", () => {
  it("fulfils the order only when the webhook arrives, not when the payment is accepted", () => {
    const { server, clock } = setup();
    const { order, paid } = checkout(server, 2);
    expect(paid.ok && paid.value.payment.status).toBe("processing");
    expect(value(server.getOrder(order.id)).status).toBe("pending");
    clock.advance(DEFAULT_CHAOS.webhookDelayMs - 1);
    expect(server.deliverDue()).toBe(0);
    clock.advance(1);
    expect(server.deliverDue()).toBe(1);
    const done = value(server.getOrder(order.id));
    expect(done.status).toBe("fulfilled");
    expect(done.tickets).toHaveLength(2);
    expect(server.available("osc-session")).toBe(9 - 2); // converted to sales, no double count
  });

  it("processes a duplicate delivery once", () => {
    const { server, clock } = setup("webhook-twice");
    const { order } = checkout(server, 1);
    clock.advance(DEFAULT_CHAOS.webhookDelayMs + DUPLICATE_GAP_MS);
    expect(server.deliverDue()).toBe(2);
    const done = value(server.getOrder(order.id));
    expect(done.status).toBe("fulfilled");
    expect(done.tickets).toHaveLength(1);
    expect(server.getState().log.some((l) => /already processed, ignored/.test(l.message))).toBe(true);
  });

  it("can complete the order before the browser even hears back", () => {
    const { server } = setup("webhook-first");
    const { order } = checkout(server, 1);
    expect(server.nextDeliveryAt()).toBe(server.getState().orders[order.id].createdAt);
    server.deliverDue();
    expect(value(server.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("refunds a payment that lands after the hold expired", () => {
    const { server, clock } = setup("hold-expires");
    const { hold, order } = checkout(server, 1);
    expect(server.getState().holds[hold.id].expiresAt).toBe(
      server.getState().payments[server.getState().orders[order.id].paymentId!].createdAt + LAST_SECONDS_MS,
    );
    clock.advance(LAST_SECONDS_MS);
    expect(value(server.getOrder(order.id)).status).toBe("pending"); // payment in flight protects it
    clock.advance(6000);
    server.deliverDue();
    const done = value(server.getOrder(order.id));
    expect(done.status).toBe("refunded");
    expect(done.statusReason).toMatch(/refunded it in full/);
    expect(done.payment?.status).toBe("refunded");
    expect(server.available("osc-session")).toBe(9); // nothing was sold
  });

  it("ignores a webhook for an order that's already settled", () => {
    const { server, clock } = setup();
    const { order } = checkout(server, 1);
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    server.deliverDue();
    const st = server.getState();
    st.outbox.push({
      deliveryId: "x",
      eventId: "evt_new",
      type: "payment.succeeded",
      paymentId: st.orders[order.id].paymentId!,
      deliverAt: clock.now(),
    });
    expect(() => server.deliverDue()).not.toThrow();
    expect(value(server.getOrder(order.id)).status).toBe("fulfilled");
  });
});

describe("persistence", () => {
  it("survives a reload mid-payment, including the webhook still in the outbox", () => {
    const { server, clock } = setup();
    const { order } = checkout(server, 1);
    const saved = serialize(server.getState());

    const restored = createServer({ now: clock.now, newId: (p) => `${p}_r`, random: () => 0.1 }, deserialize(saved)!);
    expect(restored.nextDeliveryAt()).not.toBeNull();
    clock.advance(DEFAULT_CHAOS.webhookDelayMs);
    restored.deliverDue();
    expect(value(restored.getOrder(order.id)).status).toBe("fulfilled");
  });

  it("starts fresh from unreadable or foreign storage", () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize("{not json")).toBeNull();
    expect(deserialize(JSON.stringify({ version: 9 }))).toBeNull();
  });

  it("reset keeps the chosen preset", () => {
    const { server } = setup("crowd");
    checkout(server, 1, "frontend-systems-summit", "fss-general");
    server.reset();
    expect(server.getState().presetId).toBe("crowd");
    expect(Object.keys(server.getState().holds)).toHaveLength(0);
  });
});
