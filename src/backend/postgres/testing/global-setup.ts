/**
 * Once per test run: a Postgres to test against, and a template database on it with
 * every migration applied and the catalogue seeded.
 *
 * The Postgres is `DATABASE_URL`, or the one `npm run db:up` runs; if neither answers,
 * a temporary one is started for the run (the `embedded-postgres` package's real
 * PostgreSQL 17 binaries) and stopped after it, so the tests need no setup at all.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { connect } from "@/backend/postgres/db";
import { seed } from "@/backend/postgres/seed";
import { asAdmin, serverUrl, TEMPLATE_DATABASE, urlFor } from "./database";

/** A port no developer database is likely to be on. */
const TEMPORARY_PORT = 54_391;

async function isReachable(url: string) {
  const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => undefined });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

async function startTemporaryPostgres() {
  const server = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), "admit-one-pg-")),
    port: TEMPORARY_PORT,
    user: "admit",
    password: "admit",
    persistent: false,
    // Durability is for production; this database lives for one test run.
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "max_connections=200"],
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("admit_one");
  // Test workers start after this, so they inherit it.
  process.env["DATABASE_URL"] = `postgres://admit:admit@localhost:${String(TEMPORARY_PORT)}/admit_one`;
  return server;
}

export async function setup() {
  const temporary =
    process.env["DATABASE_URL"] === undefined && !(await isReachable(serverUrl()))
      ? await startTemporaryPostgres()
      : null;

  await asAdmin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${TEMPLATE_DATABASE}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${TEMPLATE_DATABASE}"`);
  });
  const { db, close } = connect(urlFor(TEMPLATE_DATABASE), { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await seed(db);
  } finally {
    await close();
  }

  return async () => {
    await temporary?.stop();
  };
}
