import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Button } from "./button";
import { FormActions } from "./form-actions";

const meta = {
  component: FormActions,
  tags: ["autodocs"],
  args: { onBack: fn(), children: <Button type="submit">Continue</Button> },
  decorators: [
    (Story) => (
      <div className="w-[28rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormActions>;

export default meta;
// Typed from the component, so a story can take Back away (`onBack: null`).
type Story = StoryObj<typeof FormActions>;

export const WithBack: Story = {};

/** The first step has nowhere to go back to, so the action sits alone on the right. */
export const FirstStep: Story = { args: { onBack: null } };

/** While a step is saving, going back would lose the answer in flight. */
export const BackDisabled: Story = { args: { isBackDisabled: true } };
