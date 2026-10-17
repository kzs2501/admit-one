import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // UI tests run in jsdom; the simulated server's tests opt into node with a
    // `// @vitest-environment node` docblock.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/testing/**"],
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
      },
    },
  },
});
