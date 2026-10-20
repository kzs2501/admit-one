import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { Button } from "./button";

const meta = {
  component: Button,
  tags: ["autodocs"],
  args: { children: "Continue to payment", onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary", children: "Back" } };

export const Ghost: Story = { args: { variant: "ghost", children: "Cancel" } };

export const Disabled: Story = { args: { disabled: true } };

/** Busy keeps its label, so it never changes width or meaning, and can't be pressed twice. */
export const Busy: Story = {
  args: { isBusy: true, children: "Paying…" },
  play: async ({ canvas, args, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Paying…" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
