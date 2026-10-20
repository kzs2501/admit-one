import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { TextField } from "./text-field";

const meta = {
  title: "UI/Text field",
  component: TextField,
  tags: ["autodocs"],
  args: { id: "email", label: "Email", inputProps: { type: "email", autoComplete: "email" } },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = { args: { id: "phone", label: "Phone", hint: "optional", inputProps: { type: "tel" } } };

/** The error is the input's description, and `aria-invalid` marks the field. */
export const WithError: Story = {
  args: { error: "Enter an email address, like name@example.com", inputProps: { defaultValue: "asha@" } },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "Email" });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription("Enter an email address, like name@example.com");
  },
};

export const Disabled: Story = { args: { inputProps: { disabled: true, defaultValue: "asha@example.com" } } };
