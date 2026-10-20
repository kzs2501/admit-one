import { defineConfig } from "@playwright/test";

/**
 * Screenshot tests of the component catalogue. Screenshots only compare on the machine
 * that made them: the same OS, browser build, fonts and CPU architecture. Baselines are
 * made and checked in Playwright's Linux image on arm64, both on a laptop (through
 * `npm run test:visual`, which runs the browser in Docker) and in CI.
 */
const isCI = Boolean(process.env["CI"]);
const remoteBrowser = process.env["PW_VISUAL_WS"];

if (process.platform !== "linux" && !remoteBrowser) {
  throw new Error(
    "Screenshots are compared only in Playwright's Linux image. Run `npm run test:visual`, which starts it in Docker.",
  );
}

export default defineConfig({
  testDir: "visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  ...(isCI ? {} : { workers: 4 }),
  retries: 0,
  globalTimeout: 15 * 60_000,
  // A missing baseline fails CI; locally, the first run writes it, for review in the diff.
  updateSnapshots: isCI ? "none" : "missing",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/visual", open: "never" }]],
  outputDir: "test-results/visual",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
  use: {
    baseURL: "http://localhost:6007",
    deviceScaleFactor: 1,
    // The browser in Docker reaches the catalogue on this machine's localhost.
    ...(remoteBrowser ? { connectOptions: { wsEndpoint: remoteBrowser, exposeNetwork: "<loopback>" } } : {}),
  },
  webServer: {
    command: "npx vite preview --outDir storybook-static --port 6007 --strictPort",
    port: 6007,
    reuseExistingServer: false,
  },
  projects: [
    { name: "light", use: { viewport: { width: 1280, height: 800 }, colorScheme: "light" } },
    { name: "dark", use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
    { name: "mobile", grep: /@screen/, use: { viewport: { width: 375, height: 812 }, colorScheme: "light" } },
  ],
});
