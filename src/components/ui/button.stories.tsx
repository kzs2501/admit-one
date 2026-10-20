import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
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

/**
 * Busy keeps its label, so it never changes width or meaning, and can't be pressed
 * twice. It keeps keyboard focus too: a disabled button would drop it to the page.
 */
export const Busy: Story = {
  args: { isBusy: true, children: "Paying…" },
  play: async ({ canvas, args, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Paying…" });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
    await expect(button).toHaveFocus();
  },
};

/** Enter in a field submits its form by clicking the default button; busy, that click is refused. */
export const BusyInAForm: Story = {
  args: { isBusy: true, type: "submit", children: "Reserving…" },
  render: (args) => {
    const onSubmit = fn();
    return (
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          onSubmit();
          document.body.dataset["submitted"] = "true";
        }}
        className="flex items-end gap-3"
      >
        <label className="text-sm">
          Name
          <input className="mt-1 block h-11 rounded-lg border border-line bg-paper px-3" />
        </label>
        <Button {...args} />
      </form>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Name" }), "Asha{Enter}");
    await expect(document.body.dataset["submitted"]).toBeUndefined();
  },
};
