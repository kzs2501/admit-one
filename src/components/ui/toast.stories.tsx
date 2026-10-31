import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { Button } from "./button";
import { dismissToast, showToast } from "./toast";

/** Toasts appear in the app's Toaster, which every story already has (from the providers). */
function ToastTrigger({ title, detail }: { title: string; detail: string }) {
  return (
    <Button variant="secondary" onClick={() => showToast(title, detail)}>
      Refresh the order
    </Button>
  );
}

const meta = {
  title: "UI/Toast",
  component: ToastTrigger,
  args: { title: "Couldn’t refresh. Showing the last update.", detail: "Network error: the request didn’t complete." },
  // One toast lives for the whole page; don't let it outlast the story.
  beforeEach: () => dismissToast,
} satisfies Meta<typeof ToastTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Announced politely by a live region that's always in the page; focus stays where it was. */
export const Shown: Story = {
  tags: ["screen"],
  parameters: { layout: "fullscreen" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Refresh the order" });
    await userEvent.click(trigger);
    const page = canvasElement.ownerDocument.body;
    const region = await waitFor(() => {
      const status = [...page.querySelectorAll('[role="status"]')].find((node) =>
        node.textContent.includes("Couldn’t"),
      );
      if (!status) throw new Error("No toast in a status region");
      return status;
    });
    await expect(region).toHaveTextContent("Couldn’t refresh. Showing the last update.");
    await expect(trigger).toHaveFocus();
  },
};

export const Dismissed: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Refresh the order" }));
    const page = canvasElement.ownerDocument.body;
    const dismiss = await waitFor(() => {
      const button = [...page.querySelectorAll("button")].find((node) => node.textContent === "Dismiss");
      if (!button) throw new Error("No Dismiss button");
      return button;
    });
    await userEvent.click(dismiss);
    await expect(page).not.toHaveTextContent("Couldn’t refresh");
  },
};
