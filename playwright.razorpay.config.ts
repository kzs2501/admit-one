import { defineConfig, devices } from "@playwright/test";
import { createFakeRazorpay } from "./src/backend/razorpay/testing/fake-razorpay";

/**
 * Server mode taking payment through Razorpay, end to end, against a stand-in for
 * Razorpay (`e2e/fake-razorpay/server.ts`): the build is `npm run build:razorpay`, which
 * points the payment page at the stand-in's Checkout. No secrets and no network, so it
 * runs on CI. The real thing is `npm run test:e2e:razorpay-live`.
 */
const isCI = Boolean(process.env["CI"]);
const PORT = 4183;
const FAKE_PORT = 4191;
const server = process.env["DATABASE_SERVER_URL"] ?? "postgres://admit@localhost:54329";
const databaseUrl = `${server}/dresscircle_razorpay_e2e`;
const { settings } = createFakeRazorpay();

export default defineConfig<object, { databaseUrl: string | null }>({
  testDir: "e2e",
  testMatch: /razorpay\.spec\.ts/,
  // One test at a time: they share the database, whose stock each test starts from.
  workers: 1,
  retries: isCI ? 1 : 0,
  globalTimeout: 10 * 60_000,
  reporter: isCI ? "github" : "list",
  outputDir: "test-results/razorpay",
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    databaseUrl,
  },
  webServer: [
    {
      command: "npx tsx e2e/fake-razorpay/server.ts",
      url: `http://localhost:${String(FAKE_PORT)}/health`,
      reuseExistingServer: false,
      env: { FAKE_RAZORPAY_PORT: String(FAKE_PORT), APP_URL: `http://localhost:${String(PORT)}` },
    },
    {
      command: `node scripts/db.mjs reset dresscircle_razorpay_e2e && npx drizzle-kit migrate && npx next start -p ${String(PORT)}`,
      port: PORT,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-razorpay",
        DATABASE_URL: databaseUrl,
        WEBHOOK_SECRET: "whsec_e2e",
        TICKET_SIGNING_KEY: "VgjR3ifEFNcI1PdhTvaCo_-w09pHOzQ9pGr8xhm6i-Q",
        TICKET_KEY_ID: "e2e-1",
        FINGERPRINT_SECRET: "fingerprint_e2e",
        RAZORPAY_KEY_ID: settings.keyId,
        RAZORPAY_KEY_SECRET: settings.keySecret,
        RAZORPAY_WEBHOOK_SECRET: settings.webhookSecret,
        RAZORPAY_API_URL: `http://localhost:${String(FAKE_PORT)}/v1`,
        ...(process.env["DATABASE_SERVER_URL"] ? {} : { PG_PORT: "54329" }),
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
