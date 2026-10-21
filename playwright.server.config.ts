import { defineConfig, devices } from "@playwright/test";

/**
 * The buyer's end-to-end tests against server mode: the app built with
 * NEXT_PUBLIC_BACKEND=server (`npm run build:server`), on Postgres. Only tests tagged
 * @both run: the ones that drive the app the way a buyer does, without the sandbox's
 * chaos presets or its state. Postgres comes from `npm run db:up`, or DATABASE_SERVER_URL;
 * each run gets an empty database, migrated before the app starts.
 */
const isCI = Boolean(process.env["CI"]);
const PORT = 4182;
const server = process.env["DATABASE_SERVER_URL"] ?? "postgres://admit@localhost:54329";
const databaseUrl = `${server}/admit_one_e2e`;

/** The worker option `e2e/fixtures.ts` restores stock with. */
interface ServerModeOptions {
  databaseUrl: string | null;
}

export default defineConfig<object, ServerModeOptions>({
  testDir: "e2e",
  grep: /@both/,
  // One test at a time: they share the database, whose stock each test starts from.
  workers: 1,
  retries: isCI ? 1 : 0,
  globalTimeout: 10 * 60_000,
  reporter: isCI ? "github" : "list",
  outputDir: "test-results/server",
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    databaseUrl,
  },
  webServer: {
    command: `node scripts/db.mjs reset admit_one_e2e && npx drizzle-kit migrate && npx next start -p ${String(PORT)}`,
    port: PORT,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-server",
      DATABASE_URL: databaseUrl,
      WEBHOOK_SECRET: "whsec_e2e",
      // A key for these tests only, so tickets are signed as in production, on CI and off it.
      TICKET_SIGNING_KEY: "VgjR3ifEFNcI1PdhTvaCo_-w09pHOzQ9pGr8xhm6i-Q",
      TICKET_KEY_ID: "e2e-1",
      ...(process.env["DATABASE_SERVER_URL"] ? {} : { PG_PORT: "54329" }),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
