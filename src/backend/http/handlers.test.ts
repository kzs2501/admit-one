// @vitest-environment node
/**
 * The HTTP contract, exercised through real fetch calls: status codes, headers,
 * RFC 9457 problem bodies, ISO timestamps and idempotency — as the browser sees them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createBackend } from "@/backend/backend";
import { createInitialState } from "@/backend/domain/state";
import {
  eventDtoSchema,
  holdDetailsDtoSchema,
  orderDtoSchema,
  paymentResultDtoSchema,
  seatAvailabilityDtoSchema,
} from "@/contract/dto";
import { PROBLEM_CONTENT_TYPE, problemSchema } from "@/contract/problems";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { freeSeatRun, gapMakingSelection, SEATED_EVENT, seatedPlan } from "@/backend/testing/fixtures";
import { createHandlers } from "./handlers";

let idCount = 0;
const backend = createBackend(
  { now: Date.now, newId: (prefix) => `${prefix}_${++idCount}`, random: () => 0.5 },
  createInitialState(),
);
const network = setupServer(...createHandlers(backend, { sleep: () => Promise.resolve(), random: () => 0 }));

beforeAll(() => network.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  backend.setPreset("happy");
  backend.reset();
});
afterAll(() => network.close());

const BASE_URL = "http://admit-one.test";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE_URL + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

const card = { number: "4242 4242 4242 4242", expiry: "12 / 30", cvc: "123", name: "Asha Rao" };

async function reserveAndOrder() {
  const details = holdDetailsDtoSchema.parse(
    await (
      await post("/api/holds", { eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] })
    ).json(),
  );
  const order = orderDtoSchema.parse(
    await (
      await post("/api/orders", {
        holdId: details.hold.id,
        attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
        addOns: {},
      })
    ).json(),
  );
  return { details, order };
}

/** Assert an RFC 9457 response and return its parsed problem. */
async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toContain(PROBLEM_CONTENT_TYPE);
  const problem = problemSchema.parse(await response.json());
  expect(problem).toMatchObject({ status, code, type: `${BASE_URL}/problems/${code.replaceAll("_", "-")}` });
  return problem;
}

describe("HTTP contract", () => {
  it("lists events with live availability, and only public tier fields", async () => {
    const response = await fetch(`${BASE_URL}/api/events`);
    expect(response.status).toBe(200);
    const events = eventDtoSchema.array().parse(await response.json());
    const jazz = events.find((event) => event.slug === "night-market-jazz");
    expect(jazz?.tiers[0]?.available).toBe(2);
    expect(jazz?.tiers[0]).not.toHaveProperty("capacity");
  });

  it("returns 201 for a new hold, with ISO timestamps and the server's clock", async () => {
    const response = await post("/api/holds", {
      eventSlug: "open-studio-ceramics",
      items: [{ tierId: "osc-session", quantity: 2 }],
    });
    expect(response.status).toBe(201);
    const details = holdDetailsDtoSchema.parse(await response.json());
    expect(details.hold.status).toBe("active");
    expect(Date.parse(details.hold.expiresAt) - Date.parse(details.hold.createdAt)).toBe(300_000);
    expect(Number.isNaN(Date.parse(details.serverTime))).toBe(false);
  });

  it("answers a sold-out tier with a problem that says how many are left", async () => {
    const response = await post("/api/holds", {
      eventSlug: "night-market-jazz",
      items: [{ tierId: "nmj-standing", quantity: 3 }],
    });
    const problem = await expectProblem(response, 409, "sold_out");
    expect(problem).toMatchObject({ tierId: "nmj-standing", available: 2, instance: `${BASE_URL}/api/holds` });
  });

  it("rejects malformed bodies before they reach the domain", async () => {
    const empty = await post("/api/holds", { eventSlug: "open-studio-ceramics", items: [] });
    expect((await expectProblem(empty, 422, "invalid_request")).detail).toMatch(/at least one/);
    const tooMany = await post("/api/holds", {
      eventSlug: "frontend-systems-summit",
      items: [{ tierId: "fss-general", quantity: 7 }],
    });
    await expectProblem(tooMany, 422, "invalid_request");
    await expectProblem(await fetch(`${BASE_URL}/api/holds/hold_missing`), 404, "not_found");
  });

  it("creates an order with 201 and updates it with 200", async () => {
    const { details } = await reserveAndOrder();
    const again = await post("/api/orders", {
      holdId: details.hold.id,
      attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
      addOns: {},
    });
    expect(again.status).toBe(200);
  });

  it("requires the Idempotency-Key header on payments", async () => {
    const { order } = await reserveAndOrder();
    await expectProblem(await post(`/api/orders/${order.id}/payments`, card), 400, "missing_idempotency_key");
  });

  it("accepts a payment with 202 and replays the same response for the same key", async () => {
    const { order } = await reserveAndOrder();
    const headers = { [IDEMPOTENCY_KEY_HEADER]: "key-1" };
    const first = await post(`/api/orders/${order.id}/payments`, card, headers);
    expect(first.status).toBe(202);
    const replay = await post(`/api/orders/${order.id}/payments`, card, headers);
    expect(replay.status).toBe(202);
    const firstBody: unknown = await first.json();
    const replayBody: unknown = await replay.json();
    expect(replayBody).toEqual(firstBody);
    expect(paymentResultDtoSchema.parse(replayBody).payment.status).toBe("processing");
    expect(Object.keys(backend.getState().payments)).toHaveLength(1);
  });

  it("rejects a reused key for a different request", async () => {
    const { order } = await reserveAndOrder();
    const headers = { [IDEMPOTENCY_KEY_HEADER]: "key-2" };
    await post(`/api/orders/${order.id}/payments`, card, headers);
    const different = await post(
      `/api/orders/${order.id}/payments`,
      { ...card, number: "4000 0000 0000 0002" },
      headers,
    );
    await expectProblem(different, 422, "idempotency_key_reused");
  });

  it("rejects a reused key when anything differs — not just the card's last four digits", async () => {
    const { order } = await reserveAndOrder();
    const headers = { [IDEMPOTENCY_KEY_HEADER]: "key-6" };
    expect((await post(`/api/orders/${order.id}/payments`, card, headers)).status).toBe(202);
    const sameLastFour = await post(`/api/orders/${order.id}/payments`, { ...card, expiry: "11 / 29" }, headers);
    await expectProblem(sameLastFour, 422, "idempotency_key_reused");
  });

  it("answers a declined card with 402 and the failed payment's id", async () => {
    const { order } = await reserveAndOrder();
    const response = await post(
      `/api/orders/${order.id}/payments`,
      { ...card, number: "4000000000000002" },
      { [IDEMPOTENCY_KEY_HEADER]: "key-3" },
    );
    const problem = await expectProblem(response, 402, "card_declined");
    expect(problem).toHaveProperty("paymentId");
  });

  it("doesn't store a request rejected before charging, so the same key can retry once fixed", async () => {
    const { order } = await reserveAndOrder();
    const headers = { [IDEMPOTENCY_KEY_HEADER]: "key-4" };
    const invalid = await post(`/api/orders/${order.id}/payments`, { ...card, number: "4242 4242 4242 4241" }, headers);
    await expectProblem(invalid, 422, "invalid_card");
    // The request differs (a typo fixed), but nothing was stored, so this is a fresh attempt.
    expect((await post(`/api/orders/${order.id}/payments`, card, headers)).status).toBe(202);
  });

  it("can lose a charge's response, and the retry replays it instead of charging again", async () => {
    backend.setPreset("connection-drops");
    const { order } = await reserveAndOrder();
    const headers = { [IDEMPOTENCY_KEY_HEADER]: "key-5" };
    await expect(post(`/api/orders/${order.id}/payments`, card, headers)).rejects.toThrow(TypeError);
    expect(Object.keys(backend.getState().payments)).toHaveLength(1);

    const retry = await post(`/api/orders/${order.id}/payments`, card, headers);
    expect(retry.status).toBe(202);
    expect(Object.keys(backend.getState().payments)).toHaveLength(1);
  });

  it("can lose status checks after the first, as a flaky connection would", async () => {
    backend.setPreset("connection-drops");
    const { order } = await reserveAndOrder();
    const check = () => fetch(`${BASE_URL}/api/orders/${order.id}`);
    expect((await check()).status).toBe(200);
    for (let i = 0; i < 3; i++) await expect(check()).rejects.toThrow(TypeError);
    expect((await check()).status).toBe(200);
  });

  describe("reserved seating", () => {
    it("serves which seats are gone, and says which events have a map", async () => {
      const response = await fetch(`${BASE_URL}/api/events/${SEATED_EVENT}/seats`);
      expect(response.status).toBe(200);
      const availability = seatAvailabilityDtoSchema.parse(await response.json());
      expect(availability.unavailableSeatIds.length).toBeGreaterThan(0);
      await expectProblem(await fetch(`${BASE_URL}/api/events/open-studio-ceramics/seats`), 404, "not_found");

      const event = eventDtoSchema.parse(await (await fetch(`${BASE_URL}/api/events/${SEATED_EVENT}`)).json());
      expect(event.seating).toEqual({ kind: "reserved", venueId: "rangmanch-auditorium" });
    });

    it("holds particular seats with 201, and describes them", async () => {
      const seatIds = freeSeatRun(backend, 2);
      const response = await post("/api/holds", { eventSlug: SEATED_EVENT, seatIds });
      expect(response.status).toBe(201);
      const { hold } = holdDetailsDtoSchema.parse(await response.json());
      expect(hold.seats.map((seat) => seat.id)).toEqual(seatIds);
      const seat = seatedPlan().seatsById.get(seatIds[0] ?? "");
      expect(hold.seats[0]).toEqual({
        id: seat?.id,
        sectionName: seat?.sectionName,
        row: seat?.rowLabel,
        number: seat?.number,
        tierId: seat?.tierId,
      });
    });

    it("answers a taken seat with 409 and its id, holding nothing", async () => {
      const seatIds = freeSeatRun(backend, 2);
      await post("/api/holds", { eventSlug: SEATED_EVENT, seatIds });
      const problem = await expectProblem(
        await post("/api/holds", { eventSlug: SEATED_EVENT, seatIds }),
        409,
        "seats_unavailable",
      );
      expect(problem).toMatchObject({ seatIds });
    });

    it("answers a stranded seat with 422 and its id", async () => {
      const { seatIds, stranded } = gapMakingSelection(backend);
      const problem = await expectProblem(
        await post("/api/holds", { eventSlug: SEATED_EVENT, seatIds }),
        422,
        "single_seat_gap",
      );
      expect(problem).toHaveProperty("seatIds", expect.arrayContaining([stranded.id]));
    });

    it("rejects a body that's both kinds, or seats that aren't seats", async () => {
      const both = { eventSlug: SEATED_EVENT, seatIds: ["stalls-A-1"], items: [{ tierId: "ms-premium", quantity: 1 }] };
      await expectProblem(await post("/api/holds", both), 422, "invalid_request");
      const junk = await post("/api/holds", { eventSlug: SEATED_EVENT, seatIds: ["front row please"] });
      expect((await expectProblem(junk, 422, "invalid_request")).detail).toBe("That isn’t a seat.");
      await expectProblem(
        await post("/api/holds", { eventSlug: "open-studio-ceramics", seatIds: ["stalls-A-1"] }),
        422,
        "invalid_request",
      );
    });

    it("chooses the seats itself for a request by tier — the request shape that predates seats", async () => {
      const response = await post("/api/holds", {
        eventSlug: SEATED_EVENT,
        items: [{ tierId: "ms-balcony", quantity: 3 }],
      });
      expect(response.status).toBe(201);
      const { hold } = holdDetailsDtoSchema.parse(await response.json());
      expect(hold.seats).toHaveLength(3);
      expect(hold.seats.every((seat) => seat.tierId === "ms-balcony")).toBe(true);
    });
  });

  it("writes every request to the server log", async () => {
    await fetch(`${BASE_URL}/api/events`);
    expect(backend.getState().log.at(-1)?.message).toBe("GET /api/events → 200");
  });
});
