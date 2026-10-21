/**
 * The buyer's HTTP contract, as one set of tests for every backend: the sandbox in the
 * browser and the server on Postgres must answer the same requests with the same
 * statuses, headers and bodies. Each backend's test file runs it with its own harness.
 * Only tests import this.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getSeatPlan } from "@/core/catalog";
import {
  eventDtoSchema,
  holdDetailsDtoSchema,
  orderDtoSchema,
  paymentResultDtoSchema,
  seatAvailabilityDtoSchema,
} from "@/contract/dto";
import { PROBLEM_CATALOG, PROBLEM_CONTENT_TYPE, problemSchema, type ProblemCode } from "@/contract/problems";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { seatSelectionProblem } from "@/backend/domain/inventory";
import { TEST_CARDS } from "@/backend/domain/payments";

export interface ApiHarness {
  /** Answer one request, as the backend's HTTP adapter would. */
  send: (request: Request) => Promise<Response>;
  /** Move the backend's clock on. */
  advance: (ms: number) => void;
  /** Let the payment provider's webhooks that are due arrive. */
  settle: () => Promise<void>;
}

const BASE_URL = "http://admit-one.test";
const HOLD_MS = 5 * 60_000;
const WEBHOOK_DELAY_MS = 1_500;
const WORKSHOP = "fss-workshop";

const card = (number: string = TEST_CARDS.success) => ({
  method: "card",
  number,
  expiry: "12 / 30",
  cvc: "123",
  name: "Asha Rao",
});

export function describeBuyerContract(backendName: string, createHarness: () => Promise<ApiHarness> | ApiHarness) {
  describe(`the buyer's HTTP contract, on ${backendName}`, () => {
    let api: ApiHarness;
    let keyCount = 0;
    beforeEach(async () => {
      api = await createHarness();
    });

    const call = (path: string, init: RequestInit = {}) => api.send(new Request(BASE_URL + path, init));
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      call(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...headers },
      });
    const newKey = () => ({ [IDEMPOTENCY_KEY_HEADER]: `contract-key-${String(++keyCount)}-${String(Date.now())}` });

    async function expectProblem(response: Response, code: ProblemCode) {
      const { status } = PROBLEM_CATALOG[code];
      expect(response.status).toBe(status);
      expect(response.headers.get("Content-Type")).toContain(PROBLEM_CONTENT_TYPE);
      const problem = problemSchema.parse(await response.json());
      expect(problem).toMatchObject({ code, status, type: `${BASE_URL}/problems/${code.replaceAll("_", "-")}` });
      return problem;
    }

    async function hold(quantity = 1, eventSlug = "frontend-systems-summit", tierId = "fss-general") {
      const response = await post("/api/holds", { eventSlug, items: [{ tierId, quantity }] });
      expect(response.status).toBe(201);
      return holdDetailsDtoSchema.parse(await response.json());
    }

    async function order(quantity = 1) {
      const details = await hold(quantity);
      const response = await post("/api/orders", {
        holdId: details.hold.id,
        attendees: Array.from({ length: quantity }, (_, i) => ({
          name: `Guest ${String(i + 1)}`,
          email: `guest${String(i + 1)}@example.com`,
        })),
        addOns: {},
      });
      expect(response.status).toBe(201);
      return orderDtoSchema.parse(await response.json());
    }

    it("lists the events, each with its live availability", async () => {
      const response = await call("/api/events");
      expect(response.status).toBe(200);
      const events = eventDtoSchema.array().parse(await response.json());
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) for (const tier of event.tiers) expect(tier.available).toBeGreaterThanOrEqual(0);
    });

    it("answers an unknown event with a 404 problem", async () => {
      await expectProblem(await call("/api/events/no-such-event"), "not_found");
    });

    it("holds tickets: 201 with the hold, its event and ISO times", async () => {
      const details = await hold(2);
      expect(details.hold).toMatchObject({ status: "active", items: [{ tierId: "fss-general", quantity: 2 }] });
      expect(Date.parse(details.hold.expiresAt) - Date.parse(details.serverTime)).toBe(HOLD_MS);
      const read = await call(`/api/holds/${details.hold.id}`);
      expect(holdDetailsDtoSchema.parse(await read.json()).hold.id).toBe(details.hold.id);
    });

    it("refuses a malformed hold, an unknown hold, and more tickets than are left", async () => {
      await expectProblem(await post("/api/holds", { eventSlug: "frontend-systems-summit" }), "invalid_request");
      await expectProblem(await call("/api/holds/no-such-hold"), "not_found");
      // Take whatever's left of a small tier, then ask for one more.
      const event = eventDtoSchema.parse(await (await call("/api/events/frontend-systems-summit")).json());
      const workshop = event.tiers.find((tier) => tier.id === WORKSHOP);
      if (!workshop || workshop.available > 6) throw new Error("The workshop tier should have six or fewer left");
      if (workshop.available > 0) await hold(workshop.available, "frontend-systems-summit", WORKSHOP);
      const soldOut = await expectProblem(
        await post("/api/holds", { eventSlug: "frontend-systems-summit", items: [{ tierId: WORKSHOP, quantity: 1 }] }),
        "sold_out",
      );
      expect(soldOut).toMatchObject({ tierId: WORKSHOP, available: 0 });
    });

    it("creates an order for a hold once, then updates the same one", async () => {
      const created = await order();
      const updated = await post("/api/orders", {
        holdId: created.holdId,
        attendees: [{ name: "Guest A", email: "guest-a@example.com" }],
        addOns: {},
      });
      expect(updated.status).toBe(200);
      expect(orderDtoSchema.parse(await updated.json())).toMatchObject({
        id: created.id,
        attendees: [{ name: "Guest A" }],
      });
    });

    it("needs an Idempotency-Key to pay, and replays the first answer to a retry", async () => {
      const { id } = await order();
      await expectProblem(await post(`/api/orders/${id}/payments`, card()), "missing_idempotency_key");
      const key = newKey();
      const first = await post(`/api/orders/${id}/payments`, card(), key);
      expect(first.status).toBe(202);
      const firstBody = paymentResultDtoSchema.parse(await first.json());
      expect(firstBody.payment.status).toBe("processing");
      const retry = await post(`/api/orders/${id}/payments`, card(), key);
      expect(paymentResultDtoSchema.parse(await retry.json()).payment.id).toBe(firstBody.payment.id);
      await expectProblem(
        await post(`/api/orders/${id}/payments`, { ...card(), cvc: "999" }, key),
        "idempotency_key_reused",
      );
    });

    it("answers a declined card with 402, and a 3-D Secure check with 202 and what to do", async () => {
      const declined = await expectProblem(
        await post(`/api/orders/${(await order()).id}/payments`, card(TEST_CARDS.decline), newKey()),
        "card_declined",
      );
      expect(declined).toHaveProperty("paymentId");

      const challenged = await post(`/api/orders/${(await order()).id}/payments`, card(TEST_CARDS.challenge), newKey());
      expect(challenged.status).toBe(202);
      const { payment } = paymentResultDtoSchema.parse(await challenged.json());
      expect(payment).toMatchObject({ status: "requires_action", nextAction: { type: "card_challenge" } });
      const approved = await post(`/api/payments/${payment.id}/challenge`, { decision: "approve" });
      expect(paymentResultDtoSchema.parse(await approved.json()).payment.status).toBe("processing");
    });

    it("fulfils the order when the provider's webhook arrives, a ticket per attendee", async () => {
      const { id } = await order(2);
      await post(`/api/orders/${id}/payments`, card(), newKey());
      const before = orderDtoSchema.parse(await (await call(`/api/orders/${id}`)).json());
      expect(before.status).toBe("pending");
      api.advance(WEBHOOK_DELAY_MS);
      await api.settle();
      const after = orderDtoSchema.parse(await (await call(`/api/orders/${id}`)).json());
      expect(after).toMatchObject({ status: "fulfilled", payment: { status: "succeeded" } });
      expect(after.tickets.map((ticket) => ticket.attendeeName)).toEqual(["Guest 1", "Guest 2"]);
    });

    it("refuses an order for a hold that has run out", async () => {
      const details = await hold();
      api.advance(HOLD_MS);
      await expectProblem(
        await post("/api/orders", {
          holdId: details.hold.id,
          attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
          addOns: {},
        }),
        "hold_expired",
      );
    });

    it("holds particular seats once: the next buyer for them is told they've gone", async () => {
      const availability = seatAvailabilityDtoSchema.parse(
        await (await call("/api/events/monsoon-strings/seats")).json(),
      );
      const plan = getSeatPlan("monsoon-strings");
      const unavailable = new Set(availability.unavailableSeatIds);
      const pair = plan.sections
        .flatMap((section) => section.rows)
        .flatMap((row) => row.blocks)
        .flatMap((block) =>
          block.flatMap((seat, i) => {
            const next = block[i + 1];
            return next ? [[seat, next]] : [];
          }),
        )
        .find((seats) => !seatSelectionProblem(plan, unavailable, seats));
      if (!pair) throw new Error("No free pair of seats");
      const seatIds = pair.map((seat) => seat.id);
      expect((await post("/api/holds", { eventSlug: "monsoon-strings", seatIds })).status).toBe(201);
      await expectProblem(await post("/api/holds", { eventSlug: "monsoon-strings", seatIds }), "seats_unavailable");
    });
  });
}
