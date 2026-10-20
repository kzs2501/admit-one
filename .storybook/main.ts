import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: [
    { directory: "../src/components/ui", titlePrefix: "UI" },
    { directory: "../src/features", titlePrefix: "Features" },
    { directory: "../src/stories", titlePrefix: "Foundations" },
  ],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  // The app's public folder holds MSW's service worker, which sandbox-backed stories need.
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
};

export default config;
