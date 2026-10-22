/** The connection to Postgres, through postgres.js and Drizzle. Server-side only. */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface Connection {
  db: Database;
  close: () => Promise<void>;
}

/** Postgres's SQLSTATE for an error, whether the driver's own or wrapped by Drizzle. */
export function sqlStateOf(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && typeof current.code === "string") return current.code;
  }
  return undefined;
}

/** A deadlock, or a serialisation failure: the transaction did nothing, and may simply be run again. */
const RETRYABLE = new Set(["40P01", "40001"]);
const ATTEMPTS = 3;

/**
 * Run a transaction, and run it again (up to three times in all, a few jittered
 * milliseconds apart) if Postgres broke a deadlock or a serialisation conflict by
 * aborting it. Locks are taken in one order (see `stock.ts`), so this is a safety net.
 */
export async function withRetries<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= ATTEMPTS || !RETRYABLE.has(sqlStateOf(error) ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
    }
  }
}

/** `max` is the pool size: how many statements may run at once. */
export function connect(url: string, { max = 10 }: { max?: number } = {}): Connection {
  const client = postgres(url, { max, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
