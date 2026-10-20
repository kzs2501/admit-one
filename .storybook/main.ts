import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  // Every story file names itself (`title`), so the sidebar reads as the app is organised.
  stories: ["../src/**/*.mdx", "../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  // The app's public folder holds MSW's service worker, which sandbox-backed stories need.
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  // Libraries mark client components with "use client", which a static bundle doesn't
  // need; Vite warns about every one. Everything else still gets through.
  viteFinal: (config) => ({
    ...config,
    build: {
      ...config.build,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  }),
};

export default config;
