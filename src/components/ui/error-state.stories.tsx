import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ErrorState } from "./error-state";

const meta = {
  component: ErrorState,
  tags: ["autodocs"],
  args: { title: "We can’t find that order", children: "It may belong to another tab, or the sandbox was reset." },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page-level failure says what went wrong, and offers a way out. */
export const Default: Story = {};

export const OtherWayOut: Story = {
  args: {
    title: "Couldn’t load your dashboard",
    children: "Check your connection and try again.",
    action: { href: "/organiser/sign-in", label: "Sign in again" },
  },
};
