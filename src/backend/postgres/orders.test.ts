import type { IdempotencyClaim } from "@/backend/idempotency-store";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { TEST_CARDS } from "@/backend/domain/payments";
import { IDEMPOTENCY_KEY_TTL_MS } from "@/backend/backend";
import { createPostgresBackend, type PostgresBackend } from "./backend";
import { ABANDONED_AFTER_MS } from "./idempotency";
import { SERVER_SETTINGS } from "./records";
import { payments, providerEvents } from "./schema";
import { createTestDatabase } from "./testing/database";
import { signDemoTicket } from "@/core/demo-ticket-key";

const STUDIO = "open-studio-ceramics";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let backend: PostgresBackend;
let nowMs = Date.UTC(2026, 9, 21, 6, 30);
let idCount = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  backend = createPostgresBackend(database.db, {
    now: () => nowMs,
    newId: (prefix) => `${prefix}_${String(++idCount)}`,
    random: () => 0.42,
    signTicket: signDemoTicket,
  });
});
afterAll(() => database.drop());
beforeEach(() => {
  nowMs += SERVER_SETTINGS.holdDurationMs + 1;
});

const card = (number: string = TEST_CARDS.success) => ({
  method: "card" as const,
  number,
  expiry: "12 / 30",
  cvc: "123",
  name: "Asha Rao",
});

async function holdAndOrder() {
  const held = await backend.createHold({ eventSlug: STUDIO, items: [{ tierId: "osc-session", quantity: 1 }] });
  if (!held.ok) throw new Error(held.error.detail);
  const ordered = await backend.upsertOrder({
    holdId: held.value.hold.id,
    attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
    addOns: {},
  });
  if (!ordered.ok) throw new Error(ordered.error.detail);
  return { holdId: held.value.hold.id, order: ordered.value.order };
}

describe("orders on Postgres", () => {
  it("creates an order for a hold once, then updates the same one", async () => {
    const { holdId, order } = await holdAndOrder();
    const again = await backend.upsertOrder({
      holdId,
      attendees: [{ name: "Asha R. Rao", email: "asha@example.com" }],
      addOns: {},
    });
    expect(again).toMatchObject({ ok: true, value: { isCreated: false, order: { id: order.id } } });
    const read = await backend.getOrder(order.id);
    expect(read.ok && read.value.attendees[0]?.name).toBe("Asha R. Rao");
    const details = await backend.getHold(holdId);
    expect(details.ok && details.value.order?.id).toBe(order.id);
  });

  it("refuses an order for a hold that has run out, as the sandbox does", async () => {
    const held = await backend.createHold({ eventSlug: STUDIO, items: [{ tierId: "osc-session", quantity: 1 }] });
    if (!held.ok) throw new Error(held.error.detail);
    nowMs += SERVER_SETTINGS.holdDurationMs;
    const late = await backend.upsertOrder({
      holdId: held.value.hold.id,
      attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
      addOns: {},
    });
    expect(!late.ok && late.error.code).toBe("hold_expired");
  });
});

describe("payments on Postgres", () => {
  it("starts a card payment, and queues the provider's webhook a moment later", async () => {
    const { order } = await holdAndOrder();
    const paid = await backend.createPayment(order.id, card());
    expect(paid).toMatchObject({
      ok: true,
      value: { payment: { status: "processing" }, order: { status: "pending" } },
    });
    const events = await database.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.paymentId, paid.ok ? paid.value.payment.id : ""));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "payment.succeeded", deliveredAt: null });
    expect(events[0]?.deliverAt.getTime()).toBe(nowMs + SERVER_SETTINGS.webhookDelayMs);
  });

  it("answers a declined card, and a 3-D Secure check, as the sandbox does", async () => {
    const declined = await backend.createPayment((await holdAndOrder()).order.id, card(TEST_CARDS.decline));
    expect(declined).toMatchObject({
      ok: true,
      value: { payment: { status: "failed", failureCode: "card_declined" } },
    });

    const challenged = await backend.createPayment((await holdAndOrder()).order.id, card(TEST_CARDS.challenge));
    expect(challenged).toMatchObject({
      ok: true,
      value: { payment: { status: "requires_action", nextAction: { type: "card_challenge" } } },
    });
    if (!challenged.ok) return;
    const approved = await backend.confirmChallenge(challenged.value.payment.id, "approve");
    expect(approved).toMatchObject({ ok: true, value: { payment: { status: "processing" } } });
  });

  it("lets only one of ten simultaneous payments for an order through, whatever their keys", async () => {
    const { order } = await holdAndOrder();
    const results = await Promise.all(Array.from({ length: 10 }, () => backend.createPayment(order.id, card())));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.flatMap((result) => (result.ok ? [] : [result.error.code]))).toEqual(
      Array<string>(9).fill("payment_in_progress"),
    );
    const rows = await database.db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(rows).toHaveLength(1);
  });
});

describe("Idempotency-Keys on Postgres", () => {
  const answer = { fingerprint: "abc", status: 202, body: { ok: true } };
  const tokenOf = (claim: IdempotencyClaim) => {
    if (claim.kind !== "claimed") throw new Error(`Expected the key to be claimed, not ${claim.kind}`);
    return claim.token;
  };

  it("gives a key to exactly one of several requests that arrive with it at once", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => backend.idempotency.claim("key-race", "abc")));
    expect(claims.filter((claim) => claim.kind === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === "in-flight")).toHaveLength(7);
  });

  it("replays the stored answer once the request finishes, and frees a released key", async () => {
    await backend.idempotency.complete("key-done", tokenOf(await backend.idempotency.claim("key-done", "abc")), answer);
    expect(await backend.idempotency.claim("key-done", "abc")).toMatchObject({ kind: "stored", record: answer });

    await backend.idempotency.release("key-released", tokenOf(await backend.idempotency.claim("key-released", "abc")));
    expect(await backend.idempotency.claim("key-released", "abc")).toMatchObject({ kind: "claimed" });
  });

  it("lets a key whose request died with its process be claimed again, after a minute", async () => {
    await backend.idempotency.claim("key-abandoned", "abc");
    nowMs += ABANDONED_AFTER_MS - 1;
    expect(await backend.idempotency.claim("key-abandoned", "abc")).toMatchObject({ kind: "in-flight" });
    nowMs += 1;
    expect(await backend.idempotency.claim("key-abandoned", "abc")).toMatchObject({ kind: "claimed" });
  });

  it("doesn't let a request that was given up on overwrite, or give back, the claim that replaced it", async () => {
    const slow = tokenOf(await backend.idempotency.claim("key-slow", "abc"));
    nowMs += ABANDONED_AFTER_MS;
    const retry = tokenOf(await backend.idempotency.claim("key-slow", "abc"));
    // The slow request finishes at last: it must not take over the retry's claim.
    await backend.idempotency.complete("key-slow", slow, { ...answer, body: { from: "slow" } });
    await backend.idempotency.release("key-slow", slow);
    expect(await backend.idempotency.claim("key-slow", "abc")).toMatchObject({ kind: "in-flight" });
    await backend.idempotency.complete("key-slow", retry, { ...answer, body: { from: "retry" } });
    expect(await backend.idempotency.claim("key-slow", "abc")).toMatchObject({
      kind: "stored",
      record: { body: { from: "retry" } },
    });
  });

  it("treats an expired key as new even before the purge reaches it", async () => {
    const oldAt = new Date(nowMs - IDEMPOTENCY_KEY_TTL_MS);
    await database.db.execute(sql`
      INSERT INTO idempotency_keys (key, fingerprint, status, body, created_at)
      SELECT 'key-expired-' || n, 'abc', 202, '{}'::jsonb, ${oldAt.toISOString()}::timestamptz
      FROM generate_series(1, 150) AS n`);
    // The purge takes 100 at a time; whichever these are, each is claimable.
    for (const n of [1, 75, 150]) {
      expect(await backend.idempotency.claim(`key-expired-${String(n)}`, "xyz")).toMatchObject({ kind: "claimed" });
    }
  });

  it("forgets keys after 24 hours", async () => {
    await backend.idempotency.complete("key-old", tokenOf(await backend.idempotency.claim("key-old", "abc")), answer);
    nowMs += IDEMPOTENCY_KEY_TTL_MS;
    expect(await backend.idempotency.claim("key-old", "abc")).toMatchObject({ kind: "claimed" });
    const [row] = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM idempotency_keys WHERE key = 'key-old'`,
    );
    expect(row?.count).toBe(1);
  });
});
