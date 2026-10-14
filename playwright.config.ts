import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Launching a browser per core can stall a busy laptop; four is plenty for 25 tests.
  workers: process.env.CI ? undefined : 4,
  retries: process.env.CI ? 1 : 0,
  // A hung browser launch should fail the run, not stall it.
  globalTimeout: 10 * 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4180", trace: "retain-on-failure" },
  // Runs against the production build (`npm run build` first) — what actually ships.
  webServer: {
    command: "npx next start -p 4180",
    port: 4180,
    // Always start our own server: silently reusing one left over from before a rebuild
    // would test a stale build.
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
