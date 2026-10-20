import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Notice } from "./notice";
import { ErrorBoundary } from "./error-boundary";

function Broken(): never {
  throw new Error("A render error, on purpose");
}

const meta = {
  component: ErrorBoundary,
  tags: ["autodocs"],
  args: {
    fallback: (
      <Notice tone="warn" title="Chaos panel unavailable">
        Reload to retry.
      </Notice>
    ),
    children: <p>Everything is fine.</p>,
  },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {};

/** A render error stays inside the boundary: the fallback replaces only that part. */
export const Contained: Story = {
  args: { children: <Broken /> },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Chaos panel unavailable")).toBeVisible();
  },
};
