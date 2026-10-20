import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { Stepper } from "./stepper";

function ControlledStepper(props: { label: string; value: number; max: number; isDisabled?: boolean }) {
  const [value, setValue] = useState(props.value);
  return <Stepper {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: "UI/Stepper",
  component: ControlledStepper,
  tags: ["autodocs"],
  args: { label: "General", value: 1, max: 3 },
} satisfies Meta<typeof ControlledStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Each button says what it changes ("More: General"), and can't step past the bounds. */
export const StaysWithinBounds: Story = {
  play: async ({ canvas, userEvent }) => {
    const stepper = within(canvas.getByRole("group", { name: "General" }));
    const more = stepper.getByRole("button", { name: "More: General" });
    const fewer = stepper.getByRole("button", { name: "Fewer: General" });
    await userEvent.click(more);
    await userEvent.click(more);
    await expect(stepper.getByRole("status")).toHaveTextContent("3");
    await expect(more).toBeDisabled();

    // From the keyboard, the same way down to the minimum.
    fewer.focus();
    for (let press = 0; press < 3; press++) await userEvent.keyboard("{Enter}");
    await expect(stepper.getByRole("status")).toHaveTextContent("0");
    await expect(fewer).toBeDisabled();
  },
};

export const Disabled: Story = { args: { isDisabled: true } };
