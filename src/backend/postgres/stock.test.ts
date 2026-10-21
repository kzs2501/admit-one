import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import { getEvent } from "@/core/catalog";
import type { Result } from "@/backend/domain/errors";
import { createPostgresBackend, type PostgresBackend } from "./backend";
import { SERVER_SETTINGS } from "./records";
import { inventory, seatClaims } from "./schema";
import { createTestDatabase } from "./testing/database";
import { freeSeatPair } from "./testing/seats";

const SUMMIT = "frontend-systems-summit";
const GENERAL = "fss-general";
const CONCERT = "monsoon-strings";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let backend: PostgresBackend;
let nowMs = Date.UTC(2026, 9, 21, 6, 30);
let idCount = 0;

beforeAll(async () => {
  // One connection per buyer, so their statements really do run at the same time.
  database = await createTestDatabase({ poolSize: 50 });
  backend = createPostgresBackend(database.db, {
    now: () => nowMs,
    newId: (prefix) => `${prefix}_${String(++idCount)}`,
    random: () => 0.5,
  });
});
afterAll(() => database.drop());
beforeEach(async () => {
  // A whole hold's length on, with the last test's holds retired and the summit's
  // General tier down to its last 10 tickets.
  nowMs += SERVER_SETTINGS.holdDurationMs + 1;
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE holds SET status = 'expired' WHERE status = 'active'`);
    await tx.execute(
      sql`UPDATE seat_claims SET released_at = claimed_at WHERE hold_id IS NOT NULL AND released_at IS NULL`,
    );
    await tx.execute(sql`UPDATE inventory SET held = 0`);
    await tx.execute(sql`UPDATE inventory SET sold = capacity - 10 WHERE tier_id = ${GENERAL}`);
  });
});

const outcomes = (results: Result<unknown>[]) => ({
  held: results.filter((result) => result.ok).length,
  refusals: results.flatMap((result) => (result.ok ? [] : [result.error.code])),
});

async function stockOf(tierId: string) {
  const [row] = await database.db.select().from(inventory).where(eq(inventory.tierId, tierId));
  if (!row) throw new Error(`No stock for ${tierId}`);
  return row;
}

const freePair = () => freeSeatPair(database.db, CONCERT, new Date(nowMs));

describe("holding stock on Postgres", () => {
  it("lets exactly 10 of 50 buyers hold the last 10 tickets, at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        backend.createHold({ eventSlug: SUMMIT, items: [{ tierId: GENERAL, quantity: 1 }] }),
      ),
    );
    expect(outcomes(results)).toEqual({ held: 10, refusals: Array<string>(40).fill("sold_out") });
    const stock = await stockOf(GENERAL);
    expect(stock.held).toBe(10);
    expect(stock.sold + stock.held).toBe(stock.capacity);
  });

  it("gives a pair of seats to one of 20 buyers who want it, and tells the rest they've gone", async () => {
    const seatIds = await freePair();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => backend.createHold({ eventSlug: CONCERT, seatIds })),
    );
    expect(outcomes(results)).toEqual({ held: 1, refusals: Array<string>(19).fill("seats_unavailable") });
    const claims = await database.db
      .select({ seatId: seatClaims.seatId })
      .from(seatClaims)
      .where(sql`${seatClaims.seatId} IN ${seatIds} AND ${isNull(seatClaims.releasedAt)}`);
    expect(claims.map((claim) => claim.seatId).sort()).toEqual([...seatIds].sort());
  });

  it("never seats two buyers in one seat when the server chooses the best ones for them", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        backend.createHold({ eventSlug: CONCERT, items: [{ tierId: "ms-premium", quantity: 2 }] }),
      ),
    );
    const held = results.flatMap((result) => (result.ok ? result.value.hold.seats.map((seat) => seat.id) : []));
    expect(new Set(held).size).toBe(held.length);
    for (const result of results) {
      if (!result.ok) expect(["seats_unavailable", "sold_out"]).toContain(result.error.code);
    }
  });
});

describe("expiry stays lazy", () => {
  it("counts an expired hold as gone at once, and releases its tickets in the next hold", async () => {
    expect((await backend.createHold({ eventSlug: SUMMIT, items: [{ tierId: GENERAL, quantity: 10 }] })).ok).toBe(true);
    nowMs += SERVER_SETTINGS.holdDurationMs;

    // Reading never writes: the counter still has the hold, but availability doesn't.
    const event = await backend.getEvent(SUMMIT);
    expect(event.ok && event.value.tiers.find((tier) => tier.id === GENERAL)?.available).toBe(10);
    expect((await stockOf(GENERAL)).held).toBe(10);

    expect((await backend.createHold({ eventSlug: SUMMIT, items: [{ tierId: GENERAL, quantity: 10 }] })).ok).toBe(true);
    expect((await stockOf(GENERAL)).held).toBe(10);
  });

  it("frees an expired hold's seats for the next buyer", async () => {
    const seatIds = await freePair();
    expect((await backend.createHold({ eventSlug: CONCERT, seatIds })).ok).toBe(true);
    expect((await backend.createHold({ eventSlug: CONCERT, seatIds })).ok).toBe(false);
    nowMs += SERVER_SETTINGS.holdDurationMs;
    expect((await backend.createHold({ eventSlug: CONCERT, seatIds })).ok).toBe(true);
  });
});

describe("what a hold says, and refuses", () => {
  it("shows the hold with its event's live availability", async () => {
    const held = await backend.createHold({ eventSlug: SUMMIT, items: [{ tierId: GENERAL, quantity: 3 }] });
    if (!held.ok) throw new Error(held.error.detail);
    const details = await backend.getHold(held.value.hold.id);
    expect(details).toMatchObject({
      ok: true,
      value: {
        hold: { status: "active", items: [{ tierId: GENERAL, quantity: 3 }] },
        order: null,
        event: { slug: SUMMIT, isQueueActive: false },
      },
    });
    expect(details.ok && details.value.event.tiers.find((tier) => tier.id === GENERAL)?.available).toBe(7);
  });

  it("refuses what the sandbox refuses, in the same words", async () => {
    const unknownTier = await backend.createHold({ eventSlug: SUMMIT, items: [{ tierId: "nope", quantity: 1 }] });
    const seatsAtGeneral = await backend.createHold({ eventSlug: SUMMIT, seatIds: ["stalls-A-1"] });
    const notInHall = await backend.createHold({ eventSlug: CONCERT, seatIds: ["stalls-ZZ-99"] });
    const noEvent = await backend.createHold({ eventSlug: "nope", items: [{ tierId: GENERAL, quantity: 1 }] });
    expect([unknownTier, seatsAtGeneral, notInHall, noEvent].map((result) => !result.ok && result.error.code)).toEqual([
      "invalid_request",
      "invalid_request",
      "invalid_request",
      "not_found",
    ]);
    expect(getEvent(CONCERT).seating.kind).toBe("reserved");
  });
});
