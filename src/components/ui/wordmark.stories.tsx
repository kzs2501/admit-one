import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Wordmark } from "./wordmark";

const meta = { title: "UI/Wordmark", component: Wordmark, tags: ["autodocs"] } satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As the header sets it: jade, at the size of the site's name. */
export const InTheHeader: Story = {
  args: { className: "text-xl text-accent" },
  play: async ({ canvas }) => {
    // Capitals are a style: the name is still read, and found, as written.
    await expect(canvas.getByText("Dress Circle")).toBeInTheDocument();
  },
};
