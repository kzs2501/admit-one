import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { RetryNotice } from "./retry-notice";

/** The server said `Retry-After: 12`: the notice counts down from the moment it appears. */
function RetryIn({ seconds, onReady }: { seconds: number; onReady: () => void }) {
  const [retryAtMs] = useState(() => Date.now() + seconds * 1000);
  return <RetryNotice retryAtMs={retryAtMs} onReady={onReady} />;
}

const meta = {
  title: "UI/Retry notice",
  component: RetryIn,
  args: { seconds: 12, onReady: fn() },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RetryIn>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Screen readers hear the wait once, in words; the ticking clock is for eyes only. */
export const Waiting: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/You can try again in 12 seconds\./)).toHaveClass("sr-only");
  },
};
