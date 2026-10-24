/**
 * The rate limit's log on a server, where every instance has to count the same
 * attempts: a table, with the sandbox's sliding window (`http/rate-limit.ts`) worked
 * out over it. A client's attempts are counted one at a time, under a lock on its key,
 * so a burst can't all read "under the limit" at once. Only the newest `limit`
 * attempts ever decide an answer, so a client hammering away keeps that many rows.
 */
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { RateLimitStore } from "@/backend/http/rate-limit";
import { withRetries, type Database } from "./db";
import { holdAttempts } from "./schema";

/** Longer than any window: an attempt this old can't count, so it's deleted. */
const FORGET_AFTER_MS = 60 * 60_000;
/** Forgetting quiet clients is shared out: about one attempt in this many does it. */
const FORGET_EVERY = 100;

export function createPostgresRateLimit(db: Database, now: () => number): RateLimitStore {
  return {
    take: (clientKey, { limit, windowMs }) =>
      withRetries(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attempts:${clientKey}`}, 0))`);
          const nowMs = now();
          const recent = await tx
            .select({ at: holdAttempts.at })
            .from(holdAttempts)
            .where(and(eq(holdAttempts.clientKey, clientKey), gt(holdAttempts.at, new Date(nowMs - windowMs))))
            .orderBy(desc(holdAttempts.at), desc(holdAttempts.id))
            .limit(limit);
          // Refused attempts count too, as in the sandbox.
          const [attempt] = await tx
            .insert(holdAttempts)
            .values({ clientKey, at: new Date(nowMs) })
            .returning({ id: holdAttempts.id });
          await tx.execute(
            sql`DELETE FROM ${holdAttempts} WHERE ${holdAttempts.clientKey} = ${clientKey} AND ${holdAttempts.id} NOT IN (
              SELECT ${holdAttempts.id} FROM ${holdAttempts} WHERE ${holdAttempts.clientKey} = ${clientKey}
              ORDER BY ${holdAttempts.at} DESC, ${holdAttempts.id} DESC LIMIT ${limit})`,
          );
          if (attempt && attempt.id % FORGET_EVERY === 0) {
            await tx.delete(holdAttempts).where(lt(holdAttempts.at, new Date(nowMs - FORGET_AFTER_MS)));
          }

          if (recent.length < limit) return { isAllowed: true };
          // As the sandbox works it out: allowed again once fewer than `limit` remain in
          // the window, when the attempt `limit` places from the newest leaves it.
          const newestFirst = [nowMs, ...recent.map((row) => row.at.getTime())];
          const freedAtMs = (newestFirst[limit - 1] ?? nowMs) + windowMs;
          return { isAllowed: false, retryAfterMs: Math.max(0, freedAtMs - nowMs) };
        }),
      ),
  };
}
