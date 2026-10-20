import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  FULFILLED_ORDER_ID,
  LAKESIDE_BOX_OFFICE,
  LAKESIDE_OWNER,
  REFUNDED_ORDER_ID,
  signedInAs,
  untilLive,
} from "@/features/organiser/testing/story-session";
import { OrderDetail } from "./order-detail";
import { OrdersPage } from "./orders-page";
import { OrganiserShell } from "./organiser-shell";
import { Overview } from "./overview";

/**
 * The organisers' dashboard, signed in to the story's own sandbox: about 9,000 orders
 * of generated history, served by the same handlers as the app, with the live stream
 * open. Each page is shown inside the shell, as the app shows it.
 */
const meta = {
  title: "Features/Organiser/Dashboard",
  component: OrganiserShell,
  tags: ["screen"],
  args: { children: null },
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/organiser" } } },
  beforeEach: signedInAs(LAKESIDE_OWNER),
} satisfies Meta<typeof OrganiserShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The overview across all of the account's events. */
export const OverviewOfAllEvents: Story = {
  args: { children: <Overview /> },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await within(canvasElement).findByRole("heading", { name: "Tickets sold by day" });
  },
};

/** One event, with the chart's numbers opened as a table: every chart's data is one click away. */
export const OverviewOfOneEvent: Story = {
  args: { children: <Overview /> },
  parameters: { nextjs: { navigation: { pathname: "/organiser", query: { event: "lakeside-lights" } } } },
  play: async ({ canvasElement, userEvent }) => {
    await untilLive(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText("Show the numbers"));
    await expect(canvas.getByRole("table", { name: "Tickets sold and revenue, by day" })).toBeVisible();
  },
};

export const Orders: Story = {
  args: { children: <OrdersPage /> },
  parameters: { nextjs: { navigation: { pathname: "/organiser/orders" } } },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await waitFor(() => expect(within(canvasElement).getAllByRole("row").length).toBeGreaterThan(10));
  },
};

/** Filters come from the URL, so a filtered view can be shared or reloaded. */
export const OrdersFiltered: Story = {
  args: { children: <OrdersPage /> },
  parameters: {
    nextjs: { navigation: { pathname: "/organiser/orders", query: { status: "refunded", method: "upi" } } },
  },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await expect(await within(canvasElement).findByRole("checkbox", { name: "Refunded" })).toBeChecked();
  },
};

export const NoMatchingOrders: Story = {
  args: { children: <OrdersPage /> },
  parameters: { nextjs: { navigation: { pathname: "/organiser/orders", query: { q: "nobody-by-this-name" } } } },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await within(canvasElement).findByText(/No orders match/);
  },
};

export const OrderForOwner: Story = {
  args: { children: <OrderDetail orderId={FULFILLED_ORDER_ID} /> },
  parameters: { nextjs: { navigation: { pathname: `/organiser/orders/${FULFILLED_ORDER_ID}` } } },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await within(canvasElement).findByRole("button", { name: "Refund…" });
  },
};

/** The box office may read and export, not refund: the button isn't offered (and the server would refuse). */
export const OrderForBoxOffice: Story = {
  args: { children: <OrderDetail orderId={FULFILLED_ORDER_ID} /> },
  parameters: { nextjs: { navigation: { pathname: `/organiser/orders/${FULFILLED_ORDER_ID}` } } },
  beforeEach: signedInAs(LAKESIDE_BOX_OFFICE),
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 1 });
    await expect(canvas.queryByRole("button", { name: "Refund…" })).not.toBeInTheDocument();
  },
};

export const RefundedOrder: Story = {
  args: { children: <OrderDetail orderId={REFUNDED_ORDER_ID} /> },
  parameters: { nextjs: { navigation: { pathname: `/organiser/orders/${REFUNDED_ORDER_ID}` } } },
  play: async ({ canvasElement }) => {
    await untilLive(canvasElement);
    await within(canvasElement).findByRole("heading", { level: 1 });
  },
};

/**
 * A native dialog: it says what happens to the buyer's tickets, and closing it gives
 * focus back to Refund. (Escape closes it too, but only a real key press does that, so
 * the end-to-end tests check it.)
 */
export const RefundDialog: Story = {
  args: { children: <OrderDetail orderId={FULFILLED_ORDER_ID} /> },
  parameters: { nextjs: { navigation: { pathname: `/organiser/orders/${FULFILLED_ORDER_ID}` } } },
  play: async ({ canvasElement, userEvent }) => {
    await untilLive(canvasElement);
    const canvas = within(canvasElement);
    const refund = await canvas.findByRole("button", { name: "Refund…" });
    await userEvent.click(refund);
    const dialog = canvas.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainElement(canvasElement.ownerDocument.activeElement as HTMLElement);
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep the order" }));
    await expect(refund).toHaveFocus();
    await userEvent.click(refund);
  },
};
