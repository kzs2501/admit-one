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

/**
 * What a server log needs to know about a failure, and nothing a buyer typed.
 *
 * Drizzle wraps a failed query in an error whose message (and so its stack) lists the
 * query's parameters: names, emails. Postgres's own error can quote the values in its
 * `detail` ("Key (email)=(…) already exists"). So a database error is described by its
 * kind, SQLSTATE, constraint, table and column, and its cause the same way. Any other
 * error is a bug, and keeps its message and stack, which is what fixing it needs.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(`a thrown ${typeof current}`);
      break;
    }
    if (!isDatabaseError(current)) {
      parts.push(current.stack ?? `${current.name}: ${current.message}`);
      break;
    }
    const fields = current as Error & Record<string, unknown>;
    const said = (label: string, value: unknown) =>
      typeof value === "string" && value !== "" ? [`${label} ${value}`] : [];
    parts.push(
      [
        isQueryError(current) ? "Failed query" : current.name,
        ...said("code", fields["code"]),
        ...said("constraint", fields["constraint_name"]),
        ...said("table", fields["table_name"]),
        ...said("column", fields["column_name"]),
      ].join(", "),
    );
    current = current.cause;
  }
  return parts.join("\n  caused by ");
}

/** Drizzle's wrapper of a failed query: it keeps the default name, so it's known by its fields. */
const isQueryError = (error: Error) => "query" in error && "params" in error;

const isDatabaseError = (error: Error) =>
  isQueryError(error) || error.name === "PostgresError" || error.name.startsWith("Drizzle");

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
