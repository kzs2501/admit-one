import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { expect, waitFor } from "storybook/test";
import { TierPicker } from "./tier-picker";

/** Live availability comes from the sandbox, as it does on the event page. */
const meta = {
  title: "Features/Events/Tier picker",
  component: TierPicker,
  args: { slug: "frontend-systems-summit" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof TierPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summit: Story = {};

/** Choosing tickets shows the all-in total; reserving holds them and moves to checkout. */
export const Reserve: Story = {
  play: async ({ canvas, userEvent }) => {
    const [more] = await canvas.findAllByRole("button", { name: /^More: / });
    if (!more) throw new Error("No tier to add a ticket to");
    // Steppers wait for live availability before they let you choose.
    await waitFor(() => expect(more).toBeEnabled());
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("button", { name: /^Reserve/ }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledWith(expect.stringMatching(/^\/checkout\/hold_/)));
  },
};
