#!/usr/bin/env node
/**
 * A throwaway Postgres for development: its own data directory (.postgres/), on its own
 * port, so it never touches another Postgres on this machine. The server comes from
 * the `embedded-postgres` package: real PostgreSQL 17 binaries, installed by npm, so
 * there's nothing else to install. (The tests start their own; see global-setup.ts.)
 *
 *   npm run db:up     start it, creating it the first time
 *   npm run db:down   stop it
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import postgres from "postgres";

/** The binaries for this machine: `{ initdb, pg_ctl, postgres }`, as paths. */
const binaries = await import(`@embedded-postgres/${process.platform}-${process.arch}`);
const DATA = ".postgres/data";
const PORT = process.env.PG_PORT ?? "54329";
const URL = `postgres://admit@localhost:${PORT}`;

function run(command, args) {
  const result = spawnSync(binaries[command], args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const action = process.argv[2];
if (action === "up") {
  if (!existsSync(DATA)) {
    mkdirSync(".postgres", { recursive: true });
    run("initdb", [`--pgdata=${DATA}`, "--username=admit", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
  }
  // Durability is for production: these settings trade it for speed, for a database that
  // exists to be thrown away.
  const options = `-p ${PORT} -k /tmp -c max_connections=200 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`;
  run("pg_ctl", [`--pgdata=${DATA}`, "--log=.postgres/server.log", "--wait", "start", "-o", options]);
  const sql = postgres(`${URL}/postgres`, { max: 1, onnotice: () => undefined });
  const [found] = await sql`SELECT 1 FROM pg_database WHERE datname = 'admit_one'`;
  if (!found) await sql`CREATE DATABASE admit_one`;
  await sql.end();
  console.log(`Postgres is up: ${URL}/admit_one`);
} else if (action === "down") {
  run("pg_ctl", [`--pgdata=${DATA}`, "--mode=fast", "stop"]);
} else {
  console.error("usage: node scripts/db.mjs up|down");
  process.exit(1);
}
