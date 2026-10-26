import { defineConfig, devices } from "@playwright/test";
import { CAMERA_FEED } from "./e2e/door";

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
  // Writes the door scanner's camera feed.
  globalSetup: "./e2e/global-setup.ts",
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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Razorpay's flows need a build that takes payment through it (playwright.razorpay.config.ts).
      testIgnore: [/camera\.spec\.ts/, /razorpay\.spec\.ts/],
      grepInvert: /@perf/,
    },
    // Responsiveness budgets, never retried: a budget missed once is a failure, not a
    // flake. `npm run test:e2e` leaves them out, and `test:e2e:perf` runs them on their
    // own, so other tests aren't competing for the CPU while they measure.
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/camera\.spec\.ts/, /razorpay\.spec\.ts/],
      grep: /@perf/,
      retries: 0,
    },
    // The door scanner's camera: Chromium's fake camera plays a feed with a ticket in it.
    // Launch flags are the browser's, so the camera test has a project of its own, and
    // full Chromium: the headless shell Playwright runs by default has no camera at all.
    {
      name: "camera",
      testMatch: /camera\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        permissions: ["camera"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${CAMERA_FEED}`],
        },
      },
    },
  ],
});
