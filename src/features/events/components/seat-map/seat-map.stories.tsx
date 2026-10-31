import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import { SeatMap } from "./seat-map";

/**
 * The concert hall, with which seats are free coming from the story's own sandbox, in
 * the event page's own container.
 */
const meta = {
  title: "Features/Events/Seat map",
  component: SeatMap,
  // Shot as the window, not the full page: the bar of chosen seats sticks to its bottom.
  tags: ["screen", "window"],
  args: { slug: "monsoon-strings" },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SeatMap>;

export default meta;
type Story = StoryObj<typeof meta>;

async function stallsGrid(canvasElement: HTMLElement) {
  const grid = await within(canvasElement).findByRole("grid", { name: "Stalls" });
  // Availability arrives after the hall's layout: wait until a seat is offered. Every
  // seat has its name from the start, so it's a seat that can be chosen that says so.
  await waitFor(() => expect(grid.querySelector('[role="gridcell"]:not([aria-disabled])')).not.toBeNull());
  // Moving focus scrolls the page, so the page has its final layout first: its fonts.
  await canvasElement.ownerDocument.fonts.ready;
  return grid;
}

export const Hall: Story = {
  play: async ({ canvasElement }) => {
    await stallsGrid(canvasElement);
  },
};

/** One tab stop per section; arrow keys move between seats, Space chooses one (the APG grid pattern). */
export const ChooseByKeyboard: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const grid = await stallsGrid(canvasElement);
    const first = grid.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
    if (!first) throw new Error("The grid has no tab stop");
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    const moved = canvasElement.ownerDocument.activeElement;
    await expect(moved).not.toBe(first);
    await expect(moved).toHaveAttribute("role", "gridcell");
    await userEvent.keyboard(" ");
    await waitFor(() => expect(moved).toHaveAttribute("aria-selected", "true"));
  },
};
