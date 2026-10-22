/**
 * Holding stock and seats on Postgres, so two buyers can never both get the last ticket
 * or the same seat, however their requests interleave.
 *
 * - **Tickets by tier:** one conditional update of the tier's own row,
 *   `UPDATE … SET held = held + n WHERE capacity - sold - held >= n`. Under READ
 *   COMMITTED a second buyer's update waits for the first's row lock, then checks its
 *   WHERE clause again against the row as committed, so it can't oversell. The counter
 *   has to live on that row: a subquery in the WHERE clause isn't run again on that
 *   re-check, so "count the live holds" there would let both through.
 * - **Seats:** each held seat is a row in `seat_claims`, and a partial unique index
 *   allows one unreleased claim per seat. The database refuses the second claim.
 * - **Expiry stays lazy.** Nothing runs on a timer: an expired hold is released in the
 *   transaction of the next hold for that event, and reads simply leave it out.
 * - **One hold at a time per event, and locks in one order.** A hold's transaction first
 *   takes the event's advisory lock, so the single-seat-gap rule and "best available"
 *   see every seat claimed before them. Then rows are locked holds first, then tiers by
 *   id, the order a payment's conversion takes them too, so the two can't deadlock.
 */
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { findEvent, type EventInfo } from "@/core/catalog";
import type { Seat } from "@/core/seating";
import type { LineItem } from "@/core/ticketing";
import { fail, ok, type DomainError, type Result } from "@/backend/domain/errors";
import { itemsForSeats, seatSelectionProblem, seatsTaken, soldOut } from "@/backend/domain/inventory";
import { chooseBestSeats, freeSeatsInTier, isReservedEvent, type ReservedEvent } from "@/backend/domain/seating";
import { sqlStateOf, withRetries, type Database } from "./db";
import { holds, inventory, seatClaims } from "./schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | Transaction;

/** A domain error that ends the transaction: thrown inside it, so nothing is written. */
class Refusal extends Error {
  constructor(readonly problem: DomainError) {
    super(problem.detail);
  }
}

const UNIQUE_VIOLATION = "23505";

export interface NewHold {
  id: string;
  eventSlug: string;
  items: LineItem[];
  seatIds: string[];
  createdAt: Date;
  expiresAt: Date;
}

/** One hold transaction at a time for an event, until this one ends. */
async function lockEvent(tx: Transaction, eventSlug: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hold:${eventSlug}`}, 0))`);
}

/**
 * The start of every hold's transaction: the event's lock; its holds that have run out
 * marked expired (their rows locked first); then every one of its tiers locked, by id;
 * then the expired holds' tickets and seats given back.
 */
async function beginHold(tx: Transaction, event: EventInfo, now: Date) {
  await lockEvent(tx, event.slug);
  const expired = await tx
    .update(holds)
    .set({ status: "expired" })
    .where(and(eq(holds.eventSlug, event.slug), eq(holds.status, "active"), lte(holds.expiresAt, now)))
    .returning({ id: holds.id, items: holds.items });
  await tx
    .select({ tierId: inventory.tierId })
    .from(inventory)
    .where(eq(inventory.eventSlug, event.slug))
    .orderBy(asc(inventory.tierId))
    .for("update");
  if (!expired.length) return;
  const released = new Map<string, number>();
  for (const { items } of expired) {
    for (const { tierId, quantity } of items) released.set(tierId, (released.get(tierId) ?? 0) + quantity);
  }
  for (const [tierId, quantity] of [...released].sort(([left], [right]) => left.localeCompare(right))) {
    await tx
      .update(inventory)
      .set({ held: sql`${inventory.held} - ${quantity}` })
      .where(eq(inventory.tierId, tierId));
  }
  await tx
    .update(seatClaims)
    .set({ releasedAt: now })
    .where(
      and(
        inArray(
          seatClaims.holdId,
          expired.map((hold) => hold.id),
        ),
        isNull(seatClaims.releasedAt),
      ),
    );
}

/** A hall's seats that are gone right now: sold, or in a hold that hasn't run out. */
export async function unavailableSeatIds(db: Queryable, eventSlug: string, now: Date): Promise<Set<string>> {
  const rows = await db
    .select({ seatId: seatClaims.seatId })
    .from(seatClaims)
    .leftJoin(holds, eq(holds.id, seatClaims.holdId))
    .where(
      and(
        eq(seatClaims.eventSlug, eventSlug),
        isNull(seatClaims.releasedAt),
        or(eq(seatClaims.status, "sold"), and(eq(holds.status, "active"), gt(holds.expiresAt, now))),
      ),
    );
  return new Set(rows.map((row) => row.seatId));
}

/** How many of each of the event's tiers are left right now. */
export async function availability(db: Queryable, event: EventInfo, now: Date): Promise<Map<string, number>> {
  if (isReservedEvent(event)) {
    const unavailable = await unavailableSeatIds(db, event.slug, now);
    return new Map(
      event.tiers.map((tier) => [tier.id, freeSeatsInTier(event.seating.plan, unavailable, tier.id).length]),
    );
  }
  // Tickets in live holds, counted at read time: an expired hold stops counting at once,
  // even before a sweep releases it.
  // `sum` is a bigint, which the driver returns as a string.
  const rows = await db.execute<{ tierId: string; left: string }>(sql`
    SELECT inventory.tier_id AS "tierId", inventory.capacity - inventory.sold - coalesce(live.quantity, 0) AS left
    FROM inventory
    LEFT JOIN (
      SELECT item->>'tierId' AS tier_id, sum((item->>'quantity')::int) AS quantity
      FROM holds, jsonb_array_elements(holds.items) AS item
      WHERE holds.event_slug = ${event.slug} AND holds.status = 'active'
        AND holds.expires_at > ${now.toISOString()}::timestamptz
      GROUP BY 1
    ) AS live ON live.tier_id = inventory.tier_id
    WHERE inventory.event_slug = ${event.slug}`);
  return new Map(rows.map((row) => [row.tierId, Math.max(0, Number(row.left))]));
}

/** Take `quantity` from a tier, or say how many are left: one statement, race-free. */
async function takeTickets(tx: Transaction, tierId: string, quantity: number) {
  const [taken] = await tx
    .update(inventory)
    .set({ held: sql`${inventory.held} + ${quantity}` })
    .where(
      and(
        eq(inventory.tierId, tierId),
        sql`${inventory.capacity} - ${inventory.sold} - ${inventory.held} >= ${quantity}`,
      ),
    )
    .returning({ tierId: inventory.tierId });
  if (taken) return;
  const [row] = await tx
    .select({ left: sql<number>`${inventory.capacity} - ${inventory.sold} - ${inventory.held}` })
    .from(inventory)
    .where(eq(inventory.tierId, tierId));
  throw new Refusal(soldOut(tierId, Math.max(0, row?.left ?? 0)));
}

/** Claim these seats for the hold, or refuse if anyone else has one: the unique index decides. */
async function claimSeats(tx: Transaction, hold: NewHold, seats: readonly Seat[]) {
  try {
    await tx.insert(seatClaims).values(
      seats.map((seat) => ({
        eventSlug: hold.eventSlug,
        seatId: seat.id,
        holdId: hold.id,
        status: "held" as const,
        claimedAt: hold.createdAt,
      })),
    );
  } catch (error) {
    if (sqlStateOf(error) === UNIQUE_VIOLATION) throw new Refusal(seatsTaken(seats));
    throw error;
  }
}

/** Run a hold's transaction; a refusal rolls it back and becomes the result. */
async function inTransaction(db: Database, run: (tx: Transaction) => Promise<NewHold>): Promise<Result<NewHold>> {
  try {
    return ok(await withRetries(() => db.transaction(run)));
  } catch (error) {
    if (error instanceof Refusal) return fail(error.problem);
    throw error;
  }
}

const insertHold = (tx: Transaction, hold: NewHold) => tx.insert(holds).values(hold);

/** "Two Premium": by tier. For reserved seating, the server chooses the best seats left. */
export function holdByTiers(
  db: Database,
  event: EventInfo,
  draft: Omit<NewHold, "items" | "seatIds">,
  items: LineItem[],
): Promise<Result<NewHold>> {
  if (items.some(({ tierId }) => !event.tiers.some((tier) => tier.id === tierId))) {
    return Promise.resolve(fail({ code: "invalid_request", detail: "Unknown ticket type." }));
  }
  return inTransaction(db, async (tx) => {
    await beginHold(tx, event, draft.createdAt);
    if (isReservedEvent(event)) return holdBestSeats(tx, event, draft, items);
    const hold: NewHold = { ...draft, items, seatIds: [] };
    for (const { tierId, quantity } of [...items].sort((left, right) => left.tierId.localeCompare(right.tierId))) {
      await takeTickets(tx, tierId, quantity);
    }
    await insertHold(tx, hold);
    return hold;
  });
}

async function holdBestSeats(
  tx: Transaction,
  event: ReservedEvent,
  draft: Omit<NewHold, "items" | "seatIds">,
  items: LineItem[],
): Promise<NewHold> {
  const { plan } = event.seating;
  const unavailable = await unavailableSeatIds(tx, event.slug, draft.createdAt);
  const seats: Seat[] = [];
  for (const { tierId, quantity } of items) {
    const chosen = chooseBestSeats(plan, unavailable, tierId, quantity);
    if (!chosen) throw new Refusal(soldOut(tierId, freeSeatsInTier(plan, unavailable, tierId).length));
    for (const seat of chosen) unavailable.add(seat.id);
    seats.push(...chosen);
  }
  const hold: NewHold = { ...draft, items, seatIds: seats.map((seat) => seat.id) };
  await insertHold(tx, hold);
  // Chosen under the event's lock, so no other hold has claimed one since; the unique
  // index still refuses a seat a sale took, and the buyer is told it just went.
  await claimSeats(tx, hold, seats);
  return hold;
}

/** Particular seats: all of them, or none. */
export function holdSeats(
  db: Database,
  event: EventInfo,
  draft: Omit<NewHold, "items" | "seatIds">,
  seatIds: readonly string[],
): Promise<Result<NewHold>> {
  if (!isReservedEvent(event)) {
    return Promise.resolve(
      fail({ code: "invalid_request", detail: "This event has no reserved seats; choose tickets by type." }),
    );
  }
  const { plan } = event.seating;
  const seats = plan.seats.filter((seat) => seatIds.includes(seat.id)); // in hall order: how tickets are handed out
  if (seats.length !== seatIds.length) {
    return Promise.resolve(fail({ code: "invalid_request", detail: "One of those seats isn’t in this hall." }));
  }
  return inTransaction(db, async (tx) => {
    await beginHold(tx, event, draft.createdAt);
    const problem = seatSelectionProblem(plan, await unavailableSeatIds(tx, event.slug, draft.createdAt), seats);
    if (problem) throw new Refusal(problem);
    const hold: NewHold = { ...draft, items: itemsForSeats(event, seats), seatIds: seats.map((seat) => seat.id) };
    await insertHold(tx, hold);
    await claimSeats(tx, hold, seats);
    return hold;
  });
}

export const findEventOrNull = (slug: string) => findEvent(slug) ?? null;
