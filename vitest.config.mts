import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        test: {
          name: "unit",
          // UI tests run in jsdom; the simulated server's tests opt into node with a
          // `// @vitest-environment node` docblock.
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          // The server backend's tests need Postgres; they're the `server` project.
          exclude: [...configDefaults.exclude, "src/backend/postgres/**"],
          css: false,
        },
      },
      {
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
        test: {
          // The server backend, against real Postgres (`npm run db:up`, or DATABASE_URL):
          // each test file gets a fresh database, copied from a migrated template.
          name: "server",
          environment: "node",
          include: ["src/backend/postgres/**/*.test.ts"],
          globalSetup: ["src/backend/postgres/testing/global-setup.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // Every story is a test, in a real Chromium: it must render, pass its play
        // function's checks, and have no accessibility violations.
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // The server backend is measured by its own tests (`npm run test:server`), not these.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.tsx",
        "src/stories/**",
        "src/**/testing/**",
        "src/backend/postgres/**",
      ],
      reporter: ["text-summary", "html"],
      // Floors at today's numbers less two points, so coverage can't quietly slide.
      // Components and routes are mostly covered by the browser tests, so the overall
      // floor is low; the layers that hold the rules carry their own, higher ones.
      thresholds: {
        statements: 58,
        branches: 53,
        functions: 50,
        lines: 58,
        "src/core/**": { statements: 92, branches: 94, functions: 89, lines: 96 },
        "src/contract/**": { statements: 98, branches: 48, functions: 98, lines: 98 },
        "src/backend/domain/**": { statements: 92, branches: 81, functions: 96, lines: 95 },
        "src/backend/http/**": { statements: 89, branches: 78, functions: 91, lines: 90 },
        "src/features/checkout/domain/**": { statements: 87, branches: 89, functions: 89, lines: 91 },
        "src/features/events/domain/**": { statements: 95, branches: 87, functions: 98, lines: 98 },
        "src/features/queue/domain/**": { statements: 98, branches: 88, functions: 98, lines: 98 },
      },
    },
  },
});
