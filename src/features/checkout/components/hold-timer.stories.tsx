import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { HoldTimer } from "./hold-timer";

/** A hold that ends `seconds` after the story appears. */
function HeldFor({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [expiresAtMs] = useState(() => Date.now() + seconds * 1000);
  return <HoldTimer expiresAtMs={expiresAtMs} offset={0} onExpire={onExpire} />;
}

const meta = {
  title: "Features/Checkout/Hold timer",
  component: HeldFor,
  args: { seconds: 8 * 60 + 12, onExpire: fn() },
} satisfies Meta<typeof HeldFor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The visible clock ticks every second; screen readers hear it only at 2 minutes, 1 minute and 30 seconds. */
export const PlentyOfTime: Story = {};

export const LastMinute: Story = { args: { seconds: 45 } };
