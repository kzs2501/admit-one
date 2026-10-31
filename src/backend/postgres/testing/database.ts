/**
 * Real Postgres for tests: a fresh database for each test file, copied from a template
 * that's migrated and seeded once (`global-setup.ts`). Copying is quick, and no test can
 * see another's rows. Only tests import this.
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { connect } from "@/backend/postgres/db";

export const TEMPLATE_DATABASE = "dresscircle_template";

/** The server to create databases on: `DATABASE_URL`, or the one `npm run db:up` starts. */
export const serverUrl = () => process.env["DATABASE_URL"] ?? "postgres://admit@localhost:54329/dresscircle";

export function urlFor(database: string) {
  const url = new URL(serverUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

/** Run statements that can't run in a transaction, such as CREATE DATABASE. */
export async function asAdmin(run: (sql: postgres.Sql) => Promise<unknown>) {
  const sql = postgres(serverUrl(), { max: 1, onnotice: () => undefined });
  try {
    await run(sql);
  } finally {
    await sql.end();
  }
}

let created = 0;

/** A database of its own, with the schema and the catalogue's stock; `drop` it afterwards. */
export async function createTestDatabase({ poolSize = 20 }: { poolSize?: number } = {}) {
  const name = `dresscircle_test_${String(process.pid)}_${String(++created)}`;
  await asAdmin((sql) => sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DATABASE}"`));
  const connection = connect(urlFor(name), { max: poolSize });
  // Open every connection now. Opening one takes longer than a whole short transaction,
  // so on a cold pool the first of several "simultaneous" requests would finish before
  // the rest even start, and a race test would pass without the race.
  await Promise.all(Array.from({ length: poolSize }, () => connection.db.execute(sql`SELECT pg_sleep(0.02)`)));
  return {
    ...connection,
    drop: async () => {
      await connection.close();
      await asAdmin((sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
