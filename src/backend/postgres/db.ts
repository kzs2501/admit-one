/** The connection to Postgres, through postgres.js and Drizzle. Server-side only. */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface Connection {
  db: Database;
  close: () => Promise<void>;
}

/** `max` is the pool size: how many statements may run at once. */
export function connect(url: string, { max = 10 }: { max?: number } = {}): Connection {
  const client = postgres(url, { max, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
