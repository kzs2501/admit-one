import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AvailabilityBadge } from "./availability-badge";

/** How many are left, live from the story's sandbox. */
const meta = {
  title: "Features/Events/Availability badge",
  component: AvailabilityBadge,
  args: { slug: "frontend-systems-summit" },
} satisfies Meta<typeof AvailabilityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summit: Story = {};

export const ConcertHall: Story = { args: { slug: "monsoon-strings" } };
