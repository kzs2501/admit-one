import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";
import {
  attendeesFor,
  CONCERT,
  checkoutStateFor,
  completeDraft,
  holdDetailsFor,
  pendingRazorpayPayment,
  pendingUpiPayment,
  SUMMIT,
} from "@/features/checkout/testing/story-fixtures";
import { CheckoutView } from "./checkout-flow";

/**
 * The checkout in each state `useCheckout` can return. Every "ready" state comes from
 * the real view-model, so the step, the progress and the countdown are what the app
 * would show for that hold.
 */
const meta = {
  title: "Features/Checkout/Screens",
  component: CheckoutView,
  tags: ["screen"],
  parameters: { layout: "fullscreen" },
  args: { state: { kind: "loading" }, updateDraft: fn(), onExpire: fn() },
} satisfies Meta<typeof CheckoutView>;

export default meta;
type Story = StoryObj<typeof meta>;

const LUNCH = { "fss-lunch": 2 };
const summitReviewed = { ...SUMMIT, draft: completeDraft(SUMMIT, LUNCH), hasOrder: true };

export const Loading: Story = {};

export const NotFound: Story = { args: { state: { kind: "not-found" } } };

export const LoadError: Story = { args: { state: { kind: "load-error" } } };

/** The hold ran out: the checkout says so, and offers to hold the same tickets again. */
export const Expired: Story = {
  args: (() => {
    const { hold, event } = holdDetailsFor({ ...summitReviewed, minutesLeft: -1 });
    return { state: { kind: "expired", hold: { ...hold, status: "expired" }, event, stepId: "payment" } };
  })(),
};

export const Attendees: Story = { args: { state: checkoutStateFor("attendees", SUMMIT) } };

/** Submitting with names missing shows every error, and moves focus to the first field to fix. */
export const AttendeesWithErrors: Story = {
  args: { state: checkoutStateFor("attendees", SUMMIT) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    const [firstName] = await canvas.findAllByRole("textbox", { name: /name/i });
    await waitFor(() => expect(firstName).toHaveFocus());
    await expect(firstName).toBeInvalid();
  },
};

export const AddOns: Story = {
  args: { state: checkoutStateFor("add-ons", { ...SUMMIT, draft: { attendees: attendeesFor(2) } }) },
};

export const Review: Story = {
  args: { state: checkoutStateFor("review", { ...SUMMIT, draft: completeDraft(SUMMIT, LUNCH) }) },
};

/** Reserved seats are listed with the order, and each ticket names its seat. */
export const ReviewWithSeats: Story = {
  args: { state: checkoutStateFor("review", { ...CONCERT, draft: completeDraft(CONCERT) }) },
};

export const CardPayment: Story = {
  args: {
    state: checkoutStateFor("payment", {
      ...summitReviewed,
      draft: { ...summitReviewed.draft, paymentMethod: "card" },
    }),
  },
};

export const UpiPayment: Story = {
  args: {
    state: checkoutStateFor("payment", { ...summitReviewed, draft: { ...summitReviewed.draft, paymentMethod: "upi" } }),
  },
};

/** A request waits in the buyer's UPI app: scan the code, or open the app on this phone. */
export const UpiWaitingForApproval: Story = {
  args: {
    state: checkoutStateFor("payment", {
      ...summitReviewed,
      draft: { ...summitReviewed.draft, paymentMethod: "upi" },
      payment: (order) => pendingUpiPayment(order),
    }),
  },
};

export const UpiDeclined: Story = {
  args: {
    state: checkoutStateFor("payment", {
      ...summitReviewed,
      draft: { ...summitReviewed.draft, paymentMethod: "upi" },
      orderStatus: "failed",
      payment: (order) => ({
        ...pendingUpiPayment(order),
        status: "failed",
        failureCode: "upi_declined",
        nextAction: null,
      }),
    }),
  },
};

/** In the last minute, the countdown turns amber. */
/** Server mode with Razorpay: one way to pay, on Razorpay's own checkout, and what its test mode takes. */
export const RazorpayPayment: Story = {
  args: { state: checkoutStateFor("payment", { ...summitReviewed, paymentMethods: ["razorpay"] }) },
};

/** Razorpay's checkout is open (or was, before a reload): go back to it, or start again. */
export const RazorpayCheckoutOpen: Story = {
  args: {
    state: checkoutStateFor("payment", {
      ...summitReviewed,
      paymentMethods: ["razorpay"],
      payment: (order) => pendingRazorpayPayment(order),
    }),
  },
};

/** The checkout closed with nothing paid: said where focus is, with the tickets still held. */
export const RazorpayCheckoutClosed: Story = {
  args: {
    state: checkoutStateFor("payment", {
      ...summitReviewed,
      paymentMethods: ["razorpay"],
      orderStatus: "failed",
      payment: (order) => ({
        ...pendingRazorpayPayment(order),
        status: "failed",
        failureCode: "checkout_expired",
        nextAction: null,
      }),
    }),
  },
};

export const AlmostOutOfTime: Story = {
  args: { state: checkoutStateFor("review", { ...SUMMIT, draft: completeDraft(SUMMIT, LUNCH), minutesLeft: 0.75 }) },
};
