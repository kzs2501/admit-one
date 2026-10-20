import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ButtonLink } from "./button-link";

const meta = {
  title: "UI/Button link",
  component: ButtonLink,
  tags: ["autodocs"],
  args: { href: "/", children: "Browse events" },
} satisfies Meta<typeof ButtonLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Navigation that sits beside actions: it looks like a secondary button, and is a link. */
export const Default: Story = {};
