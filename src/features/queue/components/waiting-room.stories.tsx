import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { WaitingRoom } from "./waiting-room";

/** A flash sale: 40,000 people (simulated) want tickets, let in 8,000 at a time. */
const meta = {
  title: "Features/Queue/Waiting room",
  component: WaitingRoom,
  tags: ["screen"],
  args: { slug: "frontend-systems-summit" },
  parameters: { layout: "fullscreen", sandbox: { preset: "flash-sale" } },
} satisfies Meta<typeof WaitingRoom>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeJoining: Story = {
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "Join the queue" });
  },
};

/** Your place, and an honest wait, worked out from the server's clock. */
export const InTheQueue: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Join the queue" }));
    await expect(await canvas.findByText("people ahead of you")).toBeVisible();
  },
};
