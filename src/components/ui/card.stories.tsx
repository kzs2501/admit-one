import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card } from "./card";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  args: {
    className: "w-80 p-5",
    children: (
      <>
        <p className="font-medium">Frontend Systems Summit</p>
        <p className="mt-1 text-sm text-ink-2">Bengaluru · 14 November</p>
      </>
    ),
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
