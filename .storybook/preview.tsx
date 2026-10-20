import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { fontVariables } from "@/app/fonts";
import { Providers } from "@/app/providers";
import { startStorySandbox, type SandboxParameters } from "./sandbox";
import "@/app/globals.css";

// The same fonts as the root layout, on the same element.
document.documentElement.classList.add(...fontVariables.split(" "), "antialiased");

/**
 * Every story gets the app's own providers (the query client, error handling, toasts).
 * Keyed by story, so each starts with an empty cache: nothing leaks between stories.
 */
const withProviders: Decorator = (Story, { id }) => (
  <Providers key={id}>
    <Story />
  </Providers>
);

const preview: Preview = {
  decorators: [withProviders],
  // A fresh simulated backend for every story, before it renders.
  beforeEach: ({ parameters }) => startStorySandbox(parameters["sandbox"] as SandboxParameters | undefined),
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true },
    // A violation fails the story's test, in the UI and in CI.
    a11y: { test: "error" },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: { storySort: { order: ["Foundations", ["Introduction", "Colour", "Typography"], "UI", "Features"] } },
  },
};

export default preview;
