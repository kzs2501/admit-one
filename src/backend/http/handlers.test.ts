// @vitest-environment node
/**
 * The HTTP contract, exercised through real fetch calls: status codes, headers and
 * error bodies, as the browser will see them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createBackend } from "@/backend/backend";
import { initialState } from "@/backend/domain/state";
import { createHandlers } from "./handlers";

let n = 0;
const sim = createBackend({ now: Date.now, newId: (p) => `${p}_${++n}`, random: () => 0.5 }, initialState());
const network = setupServer(...createHandlers(sim, { sleep: async () => {}, random: () => 0 }));

beforeAll(() => network.listen({ onUnhandledFrame: "error" }));
afterEach(() => sim.reset());
afterAll(() => network.close());

const base = "http://admit-one.test";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

async function reserveAndOrder() {
  const hold = await (
    await post("/api/holds", { eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", qty: 1 }] })
  ).json();
  const order = await (
    await post("/api/orders", {
      holdId: hold.hold.id,
      attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
      addOns: {},
    })
  ).json();
  return { hold, order };
}

const card = { number: "4242 4242 4242 4242", expiry: "12 / 30", cvc: "123", name: "Asha Rao" };

describe("HTTP contract", () => {
  it("lists events with live availability", async () => {
    const res = await fetch(`${base}/api/events`);
    expect(res.status).toBe(200);
    const events = await res.json();
    expect(events.find((e: { slug: string }) => e.slug === "night-market-jazz").tiers[0].available).toBe(2);
  });

  it("returns 201 for a new hold, with the server's clock", async () => {
    const res = await post("/api/holds", {
      eventSlug: "open-studio-ceramics",
      items: [{ tierId: "osc-session", qty: 2 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hold.status).toBe("active");
    expect(typeof body.serverNow).toBe("number");
  });

  it("returns 409 with a machine-readable code when sold out", async () => {
    const res = await post("/api/holds", {
      eventSlug: "night-market-jazz",
      items: [{ tierId: "nmj-standing", qty: 3 }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "sold_out", details: { available: 2 } } });
  });

  it("returns 404 and 422 with error bodies", async () => {
    expect((await fetch(`${base}/api/holds/hold_missing`)).status).toBe(404);
    const bad = await post("/api/holds", { eventSlug: "open-studio-ceramics", items: [] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toMatch(/at least one/);
  });

  it("requires the Idempotency-Key header on payments", async () => {
    const { order } = await reserveAndOrder();
    expect((await post(`/api/orders/${order.id}/payments`, card)).status).toBe(400);
  });

  it("accepts a payment with 202 and replays it for the same key", async () => {
    const { order } = await reserveAndOrder();
    const first = await post(`/api/orders/${order.id}/payments`, card, { "Idempotency-Key": "abc" });
    expect(first.status).toBe(202);
    const replay = await post(`/api/orders/${order.id}/payments`, card, { "Idempotency-Key": "abc" });
    expect(replay.status).toBe(202);
    expect((await replay.json()).payment.id).toBe((await first.json()).payment.id);
  });

  it("returns 402 for a declined card", async () => {
    const { order } = await reserveAndOrder();
    const res = await post(
      `/api/orders/${order.id}/payments`,
      { ...card, number: "4000000000000002" },
      { "Idempotency-Key": "d" },
    );
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("card_declined");
  });

  it("writes every request to the server log", async () => {
    await fetch(`${base}/api/events`);
    expect(sim.getState().log.at(-1)?.message).toBe("GET /api/events → 200");
  });
});
