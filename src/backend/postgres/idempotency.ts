/**
 * Idempotency-Keys in Postgres, so they hold across server processes. A key is claimed
 * with an insert that does nothing on conflict: of two requests with the same key at
 * the same moment, exactly one gets it, and the other is told it's in flight.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { IDEMPOTENCY_KEY_TTL_MS } from "@/backend/backend";
import type { IdempotencyClaim, IdempotencyStore } from "@/backend/port";
import type { Database } from "./db";
import type { ServerDeps } from "./records";
import { idempotencyKeys } from "./schema";

/**
 * A request still in flight after this long died with its process. Its key can be
 * claimed again: if the work did happen, the order's own state says so (a payment in
 * progress, or already made), so a retry still can't charge twice.
 */
export const ABANDONED_AFTER_MS = 60_000;

export function createIdempotencyStore(db: Database, deps: ServerDeps) {
  async function claim(key: string, fingerprint: string): Promise<IdempotencyClaim> {
    const now = new Date(deps.now());
    // Keys past their 24 hours go a few at a time, as new ones arrive.
    await db.execute(sql`
      DELETE FROM idempotency_keys WHERE key IN (
        SELECT key FROM idempotency_keys WHERE created_at <= ${new Date(deps.now() - IDEMPOTENCY_KEY_TTL_MS).toISOString()}::timestamptz LIMIT 100
      )`);
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({ key, fingerprint, createdAt: now })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    // The claim's creation time is its version, and so its token.
    if (claimed) return { kind: "claimed", token: now.toISOString() };

    const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    if (!row) return claim(key, fingerprint); // released a moment ago: try again
    const ageMs = now.getTime() - row.createdAt.getTime();
    const isExpired = ageMs >= IDEMPOTENCY_KEY_TTL_MS;
    if (row.status !== null && !isExpired) {
      return {
        kind: "stored",
        record: {
          fingerprint: row.fingerprint,
          status: row.status,
          body: row.body ?? null,
          createdAtMs: row.createdAt.getTime(),
        },
      };
    }
    // A key past its 24 hours is new again; one in flight for over a minute was abandoned.
    if (isExpired || (row.status === null && ageMs >= ABANDONED_AFTER_MS)) {
      const [taken] = await db
        .update(idempotencyKeys)
        .set({ fingerprint, status: null, body: null, createdAt: now })
        // The creation time is the version: if another request reclaimed it first, this matches nothing.
        .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.createdAt, row.createdAt)))
        .returning({ key: idempotencyKeys.key });
      if (taken) return { kind: "claimed", token: now.toISOString() };
    }
    return { kind: "in-flight", fingerprint: row.fingerprint };
  }

  /** This claim of the key, and no later one. */
  const ownClaim = (key: string, token: string) =>
    and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.createdAt, new Date(token)));

  return {
    claim,
    complete: async (key, token, { status, body }) => {
      await db.update(idempotencyKeys).set({ status, body }).where(ownClaim(key, token));
    },
    release: async (key, token) => {
      await db.delete(idempotencyKeys).where(and(ownClaim(key, token), isNull(idempotencyKeys.status)));
    },
  } satisfies IdempotencyStore;
}
