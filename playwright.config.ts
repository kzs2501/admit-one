import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Launching a browser per core can stall a busy laptop; four is plenty for 25 tests.
  ...(isCI ? {} : { workers: 4 }),
  retries: isCI ? 1 : 0,
  // A hung browser launch should fail the run, not stall it.
  globalTimeout: 10 * 60_000,
  reporter: isCI ? "github" : "list",
  // CI traces the retry of a failed test (Playwright's advice: cheap, and it's the run
  // that shows a flake); locally, keep the trace of whatever failed.
  use: { baseURL: "http://localhost:4180", trace: isCI ? "on-first-retry" : "retain-on-failure" },
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
