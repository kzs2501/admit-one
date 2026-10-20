import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { cardPayment, CONCERT, orderPageStateFor } from "@/features/orders/testing/story-fixtures";
import { OrderStatusScreen } from "./order-status-view";

/** The order page in each state `useOrderStatus` can return. */
const meta = {
  title: "Features/Orders/Order page",
  component: OrderStatusScreen,
  tags: ["screen"],
  parameters: { layout: "fullscreen" },
  args: { state: { kind: "loading" } },
} satisfies Meta<typeof OrderStatusScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

export const NotFound: Story = { args: { state: { kind: "not-found" } } };

export const LoadError: Story = { args: { state: { kind: "load-error" } } };

export const AwaitingPayment: Story = {
  args: { state: orderPageStateFor("awaiting-payment", { status: "pending" }) },
};

/** The bank has the payment; the webhook hasn't confirmed it yet. The page updates on its own. */
export const Confirming: Story = {
  args: { state: orderPageStateFor("confirming", { payment: cardPayment({ status: "processing" }) }) },
};

/** Confirmation is taking longer than usual: the page says the payment is safe, and nothing needs doing. */
export const ConfirmingSlowly: Story = {
  args: {
    state: orderPageStateFor("confirming", { payment: cardPayment({ status: "processing" }) }, { isSlow: true }),
  },
};

/** Focus moves to the outcome, so it's announced and in view. */
export const Fulfilled: Story = {
  args: { state: orderPageStateFor("fulfilled", { status: "fulfilled", payment: cardPayment() }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveFocus();
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
  },
};

export const FulfilledWithSeats: Story = {
  args: {
    state: orderPageStateFor(
      "fulfilled",
      { status: "fulfilled", payment: cardPayment({ method: "upi", last4: null }) },
      { scene: CONCERT },
    ),
  },
};

export const Refunded: Story = {
  args: {
    state: orderPageStateFor("refunded", {
      status: "refunded",
      payment: cardPayment({ status: "refunded" }),
      statusReason: "The organiser refunded this order in full.",
    }),
  },
};

export const Expired: Story = {
  args: {
    state: orderPageStateFor("expired", {
      status: "expired",
      statusReason: "Your reservation expired before payment was completed.",
    }),
  },
};

export const Failed: Story = {
  args: {
    state: orderPageStateFor("failed", {
      status: "failed",
      payment: cardPayment({ status: "failed", failureCode: "card_declined" }),
      statusReason: "Your card was declined.",
    }),
  },
};
