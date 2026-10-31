/**
 * The rate limit on a server, against real Postgres: the same answers as the sandbox's
 * window for the same attempts, the limit held under a burst from one client, clients
 * kept apart, and storage that stays small however hard a client hammers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { clientKeyOf, createServerApi } from "@/backend/server";
import { createSlidingWindow } from "@/backend/http/rate-limit";
import { signDemoTicket } from "@/core/demo-ticket-key";
import { createPostgresRateLimit } from "./rate-limit";
import { holdAttempts } from "./schema";
import { createTestDatabase } from "./testing/database";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.drop());

const rowsFor = async (clientKey: string) =>
  (await database.db.select().from(holdAttempts).where(eq(holdAttempts.clientKey, clientKey))).length;

describe("the rate limit, on Postgres", () => {
  it("gives the sandbox's answers for the same attempts", async () => {
    let nowMs = Date.UTC(2026, 9, 24, 9);
    const clock = () => nowMs;
    const sandbox = createSlidingWindow(clock);
    const server = createPostgresRateLimit(database.db, clock);
    const limit = { limit: 3, windowMs: 10_000 };
    // Steady, then hammering, then waiting it out, then a burst at one instant.
    const gapsMs = [0, 1_000, 1_000, 1_000, 500, 500, 8_000, 1_000, 12_000, 0, 0, 0, 0];
    for (const gapMs of gapsMs) {
      nowMs += gapMs;
      expect(await server.take("ip:203.0.113.7", limit)).toEqual(sandbox.take(limit));
    }
  });

  it("lets exactly the limit through when one client's attempts all arrive at once", async () => {
    const limiter = createPostgresRateLimit(database.db, () => Date.UTC(2026, 9, 24, 10));
    // A limit below the pool's 20 connections: without the lock, all 20 in the first
    // wave would read an empty log, and get through.
    const decisions = await Promise.all(
      Array.from({ length: 30 }, async () => limiter.take("ip:198.51.100.4", { limit: 10, windowMs: 60_000 })),
    );
    expect(decisions.filter((decision) => decision.isAllowed)).toHaveLength(10);
  });

  it("counts each client on its own", async () => {
    const limiter = createPostgresRateLimit(database.db, () => Date.UTC(2026, 9, 24, 11));
    const limit = { limit: 2, windowMs: 60_000 };
    await limiter.take("ip:192.0.2.1", limit);
    await limiter.take("ip:192.0.2.1", limit);
    expect((await limiter.take("ip:192.0.2.1", limit)).isAllowed).toBe(false);
    expect((await limiter.take("ip:192.0.2.2", limit)).isAllowed).toBe(true);
  });

  it("keeps a client's newest few attempts, not every one", async () => {
    let nowMs = Date.UTC(2026, 9, 24, 12);
    const limiter = createPostgresRateLimit(database.db, () => (nowMs += 10));
    for (let i = 0; i < 50; i++) await limiter.take("ip:192.0.2.9", { limit: 5, windowMs: 60_000 });
    expect(await rowsFor("ip:192.0.2.9")).toBe(5);
  });
});

describe("the server's rate limit on reserving", () => {
  const api = (clientIpHeader: string | null) =>
    createServerApi(
      database.db,
      {
        now: Date.now,
        newId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
        random: () => 0,
        signTicket: signDemoTicket,
      },
      { webhookSecret: "whsec_rate_limit", clientIpHeader },
    );
  // Bodies that don't parse are attempts too, so these use no stock.
  const reserve = (server: ReturnType<typeof api>, ip: string) =>
    server.handle(
      new Request("http://dresscircle.test/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` },
        body: "{}",
      }),
    );

  it("refuses a client's 21st attempt in a minute, with Retry-After, and lets another client in", async () => {
    const server = api("x-forwarded-for");
    for (let i = 0; i < 20; i++) expect((await reserve(server, "203.0.113.50")).status).toBe(422);
    const refused = await reserve(server, "203.0.113.50");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await reserve(server, "203.0.113.51")).status).toBe(422);
  });

  it("doesn't limit what it can't tell apart: no trusted header, no limit", async () => {
    const server = api(null);
    for (let i = 0; i < 25; i++) expect((await reserve(server, "203.0.113.60")).status).toBe(422);
    await expect(
      database.db.execute(sql`SELECT count(*)::int AS count FROM hold_attempts WHERE client_key = 'ip:203.0.113.60'`),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("keys a client by the first address a trusted proxy names, and nobody by a header it doesn't trust", () => {
    const request = new Request("http://dresscircle.test/", {
      headers: { "X-Forwarded-For": "203.0.113.70, 10.0.0.1" },
    });
    expect(clientKeyOf(request, "x-forwarded-for")).toBe("ip:203.0.113.70");
    expect(clientKeyOf(request, null)).toBeNull();
    expect(clientKeyOf(new Request("http://dresscircle.test/"), "x-forwarded-for")).toBeNull();
  });
});
