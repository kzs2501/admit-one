import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Spinner } from "./spinner";

const meta = { component: Spinner, tags: ["autodocs"] } satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Decorative beside a label that already says what's happening ("Paying…"). */
export const Decorative: Story = {};

/** On its own, it's a status with a name, so screen readers hear what's loading. */
export const Labelled: Story = {
  args: { label: "Loading your order", className: "size-8 text-accent" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Loading your order" })).toBeInTheDocument();
  },
};
