/**
 * Once per test run: a Postgres to test against, and a template database on it with
 * every migration applied and the catalogue seeded.
 *
 * The Postgres is `DATABASE_URL`, or the one `npm run db:up` runs; if neither answers,
 * the same one is started for the run (`scripts/db.mjs`, in a process of its own) and
 * stopped after it, so the tests need no setup at all.
 *
 * Never in this process: the `embedded-postgres` package registers an exit hook as
 * it's imported (`async-exit-hook`), and that hook ends the process with code 0. A test
 * run that failed would then report success, to a terminal and to CI alike.
 */
import { execFileSync } from "node:child_process";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { connect } from "@/backend/postgres/db";
import { seed } from "@/backend/postgres/seed";
import { asAdmin, serverUrl, TEMPLATE_DATABASE, urlFor } from "./database";

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

const devDatabase = (action: "up" | "down") => {
  execFileSync(process.execPath, ["scripts/db.mjs", action], { stdio: "inherit" });
};

export async function setup() {
  const isStartedHere = process.env["DATABASE_URL"] === undefined && !(await isReachable(serverUrl()));
  if (isStartedHere) devDatabase("up");

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

  return () => {
    if (isStartedHere) devDatabase("down");
  };
}
