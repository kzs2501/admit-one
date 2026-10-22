import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getResponse } from "msw";
import { and, eq, isNull } from "drizzle-orm";
import { TEST_CARDS } from "@/backend/domain/payments";
import { createKit } from "@/backend/http/kit";
import { createWebhookHandlers } from "@/backend/http/webhook-handlers";
import { API_ROUTES, WEBHOOK_SIGNATURE_HEADER } from "@/contract/routes";
import { problemSchema } from "@/contract/problems";
import { createPostgresBackend, type PostgresBackend } from "./backend";
import { signWebhook, SIGNATURE_TOLERANCE_MS } from "./provider";
import { SERVER_SETTINGS } from "./records";
import { inventory, providerEvents, seatClaims, webhookEvents } from "./schema";
import { createTestDatabase } from "./testing/database";
import { freeSeatPair } from "./testing/seats";
import { createWebhookReceiver, MAX_DELIVERY_ATTEMPTS, sendDueWebhooks } from "./webhooks";
import { signDemoTicket } from "@/core/demo-ticket-key";

const SECRET = "whsec_test_secret";
const ORIGIN = "http://admit-one.test";
const STUDIO = "open-studio-ceramics";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let backend: PostgresBackend;
let nowMs = Date.UTC(2026, 9, 21, 6, 30);
let idCount = 0;
let handlers: ReturnType<typeof createWebhookHandlers>;
const deps = {
  now: () => nowMs,
  newId: (prefix: string) => `${prefix}_${String(++idCount)}`,
  random: () => 0.42,
  signTicket: signDemoTicket,
};

beforeAll(async () => {
  database = await createTestDatabase();
  backend = createPostgresBackend(database.db, deps);
  const kit = createKit(backend, { sleep: () => Promise.resolve(), random: () => 0 });
  handlers = createWebhookHandlers(createWebhookReceiver(database.db, deps, SECRET), kit);
});
afterAll(() => database.drop());
beforeEach(() => {
  nowMs += SERVER_SETTINGS.holdDurationMs + 1;
});

/** The server's webhook endpoint, answering a request as it would over HTTP. */
async function send(request: Request): Promise<Response> {
  const response = await getResponse(handlers, request);
  if (!response) throw new Error("No handler for the webhook");
  return response;
}

const sendDue = (through: (request: Request) => Promise<Response> = send) =>
  sendDueWebhooks(database.db, deps, { secret: SECRET, send: through, origin: ORIGIN });

const failing = () => Promise.reject(new Error("The endpoint is down"));

async function eventFor(paymentId: string) {
  const [event] = await database.db.select().from(providerEvents).where(eq(providerEvents.paymentId, paymentId));
  if (!event) throw new Error(`No provider event for ${paymentId}`);
  return event;
}

async function paidOrder({ eventSlug = STUDIO, seatIds }: { eventSlug?: string; seatIds?: string[] } = {}) {
  const held = await backend.createHold(
    seatIds ? { eventSlug, seatIds } : { eventSlug, items: [{ tierId: "osc-session", quantity: 1 }] },
  );
  if (!held.ok) throw new Error(held.error.detail);
  const attendees = held.value.hold.seats.length
    ? held.value.hold.seats.map((_, i) => ({
        name: `Guest ${String(i + 1)}`,
        email: `guest${String(i + 1)}@example.com`,
      }))
    : [{ name: "Asha Rao", email: "asha@example.com" }];
  const ordered = await backend.upsertOrder({ holdId: held.value.hold.id, attendees, addOns: {} });
  if (!ordered.ok) throw new Error(ordered.error.detail);
  const paid = await backend.createPayment(ordered.value.order.id, {
    method: "card",
    number: TEST_CARDS.success,
    expiry: "12 / 30",
    cvc: "123",
    name: "Asha Rao",
  });
  if (!paid.ok) throw new Error(paid.error.detail);
  return { holdId: held.value.hold.id, orderId: ordered.value.order.id, paymentId: paid.value.payment.id };
}

async function soldOf(tierId: string) {
  const [row] = await database.db.select().from(inventory).where(eq(inventory.tierId, tierId));
  return { sold: row?.sold ?? 0, held: row?.held ?? 0 };
}

/** A new webhook for a payment, signed by the provider now. */
function webhookFor(paymentId: string) {
  const body = JSON.stringify({
    id: `evt_${String(++idCount)}`,
    type: "payment.succeeded",
    created: Math.floor(nowMs / 1000),
    data: { paymentId },
  });
  return { body, signature: signWebhook(SECRET, body, nowMs) };
}

const post = (body: string, signature: string | null) =>
  send(
    new Request(new URL(API_ROUTES.providerWebhook, ORIGIN), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature ? { [WEBHOOK_SIGNATURE_HEADER]: signature } : {}) },
      body,
    }),
  );

describe("the simulated provider's webhooks", () => {
  it("sends nothing before it's due, then fulfils the order and sells its ticket", async () => {
    const { orderId } = await paidOrder();
    const before = await soldOf("osc-session");
    expect(await sendDue()).toBe(0);

    nowMs += SERVER_SETTINGS.webhookDelayMs;
    expect(await sendDue()).toBe(1);
    const order = await backend.getOrder(orderId);
    expect(order).toMatchObject({ ok: true, value: { status: "fulfilled", tickets: [{ attendeeName: "Asha Rao" }] } });
    expect(await soldOf("osc-session")).toEqual({ sold: before.sold + 1, held: before.held - 1 });
    const unsent = await database.db.select().from(providerEvents).where(isNull(providerEvents.deliveredAt));
    expect(unsent).toHaveLength(0);
  });

  it("turns a seated hold's claims into sales", async () => {
    const pair = await freeSeatPair(database.db, "monsoon-strings", new Date(nowMs));
    const { holdId } = await paidOrder({ eventSlug: "monsoon-strings", seatIds: pair });
    nowMs += SERVER_SETTINGS.webhookDelayMs;
    await sendDue();
    const claims = await database.db
      .select({ status: seatClaims.status })
      .from(seatClaims)
      .where(and(eq(seatClaims.holdId, holdId), isNull(seatClaims.releasedAt)));
    expect(claims.map((claim) => claim.status)).toEqual(["sold", "sold"]);
  });

  it("tries a failed delivery again later, and acts on it once", async () => {
    const { orderId, paymentId } = await paidOrder();
    nowMs += SERVER_SETTINGS.webhookDelayMs;
    expect(await sendDue(failing)).toBe(0);
    expect(await eventFor(paymentId)).toMatchObject({
      attempts: 1,
      lastError: "The endpoint is down",
      deliveredAt: null,
    });
    // Not due again until its back-off has passed.
    expect(await sendDue()).toBe(0);
    nowMs += 1_000;
    expect(await sendDue()).toBe(1);
    expect(await backend.getOrder(orderId)).toMatchObject({ ok: true, value: { status: "fulfilled" } });
  });

  it("sends each due event once, with two senders at the same moment", async () => {
    const orders = await Promise.all([paidOrder(), paidOrder(), paidOrder()]);
    nowMs += SERVER_SETTINGS.webhookDelayMs;
    const sends = new Map<string, number>();
    const counting = async (request: Request) => {
      const { id } = (await request.clone().json()) as { id: string };
      sends.set(id, (sends.get(id) ?? 0) + 1);
      return send(request);
    };
    const [first, second] = await Promise.all([sendDue(counting), sendDue(counting)]);
    expect(first + second).toBeGreaterThanOrEqual(orders.length);
    expect([...sends.values()].every((count) => count === 1)).toBe(true);
    for (const { paymentId } of orders) expect(sends.get((await eventFor(paymentId)).eventId)).toBe(1);
  });

  it("stops trying an event that has failed ten times, for someone to look at", async () => {
    const { paymentId } = await paidOrder();
    nowMs += SERVER_SETTINGS.webhookDelayMs;
    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
      await sendDue(failing);
      nowMs += 61_000;
    }
    expect(await eventFor(paymentId)).toMatchObject({ attempts: MAX_DELIVERY_ATTEMPTS, deliveredAt: null });
    await sendDue();
    expect((await eventFor(paymentId)).deliveredAt).toBeNull();
  });

  it("refunds a payment confirmed after its hold ran out, and sells nothing", async () => {
    const { orderId } = await paidOrder();
    const before = await soldOf("osc-session");
    nowMs += SERVER_SETTINGS.holdDurationMs * 2;
    await sendDue();
    const order = await backend.getOrder(orderId);
    expect(order).toMatchObject({ ok: true, value: { status: "refunded" } });
    expect((await soldOf("osc-session")).sold).toBe(before.sold);
  });
});

describe("receiving webhooks", () => {
  it("acts on an event once, however many times it arrives, at once or later", async () => {
    const { orderId, paymentId } = await paidOrder();
    const before = await soldOf("osc-session");
    const { body, signature } = webhookFor(paymentId);
    const outcomes = await Promise.all(
      Array.from(
        { length: 5 },
        async () => ((await (await post(body, signature)).json()) as { outcome: string }).outcome,
      ),
    );
    expect(outcomes.sort()).toEqual(["duplicate", "duplicate", "duplicate", "duplicate", "processed"]);
    const again = (await (await post(body, signature)).json()) as { outcome: string };
    expect(again.outcome).toBe("duplicate");
    expect((await soldOf("osc-session")).sold).toBe(before.sold + 1);
    expect((await backend.getOrder(orderId)).ok).toBe(true);
  });

  it("answers 404 for a payment it doesn't know yet, so it's sent again, and marks nothing handled", async () => {
    const { body, signature } = webhookFor("pay_not_yet_recorded");
    const response = await post(body, signature);
    expect(response.status).toBe(404);
    expect(problemSchema.parse(await response.json()).code).toBe("not_found");
    const { id } = JSON.parse(body) as { id: string };
    expect(await database.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, id))).toHaveLength(0);
  });

  it("takes either signature while the secret is being rotated", async () => {
    const { paymentId } = await paidOrder();
    const { body } = webhookFor(paymentId);
    const [stamp, current] = signWebhook(SECRET, body, nowMs).split(",");
    const old = signWebhook("whsec_old", body, nowMs).split(",")[1];
    // The current one first: a parser that kept only the last v1 would miss it.
    const response = await post(body, `${stamp ?? ""},${current ?? ""},${old ?? ""}`);
    expect(((await response.json()) as { outcome: string }).outcome).toBe("processed");
  });

  it("refuses a failure it doesn't understand, rather than calling it something else", async () => {
    const { paymentId } = await paidOrder();
    const body = JSON.stringify({
      id: `evt_${String(++idCount)}`,
      type: "payment.failed",
      created: Math.floor(nowMs / 1000),
      data: { paymentId, failureCode: "card_declined" },
    });
    const response = await post(body, signWebhook(SECRET, body, nowMs));
    expect(response.status).toBe(400);
  });

  it("refuses forged, altered, replayed and unsigned webhooks, and changes nothing", async () => {
    const { orderId, paymentId } = await paidOrder();
    const genuine = webhookFor(paymentId);
    const attempts = [
      post(genuine.body, signWebhook("not-the-secret", genuine.body, nowMs)),
      post(genuine.body.replace(paymentId, "pay_someone_else"), genuine.signature),
      post(genuine.body, signWebhook(SECRET, genuine.body, nowMs - SIGNATURE_TOLERANCE_MS - 1_000)),
      post(genuine.body, null),
      post(genuine.body, "t=1,v1=not-hex"),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(400);
      expect(problemSchema.parse(await response.json()).code).toBe("invalid_signature");
    }
    expect(await backend.getOrder(orderId)).toMatchObject({ ok: true, value: { status: "pending" } });
  });
});
