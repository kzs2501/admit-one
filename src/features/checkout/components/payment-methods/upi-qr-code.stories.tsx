import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UpiQrCode } from "./upi-qr-code";

const meta = {
  title: "Features/Checkout/UPI QR code",
  component: UpiQrCode,
  args: {
    value: "upi://pay?pa=admit-one@example&pn=admit-one&mc=7922&tr=pay_story&tn=Order%20ord_story&am=12151.58&cu=INR",
    label: "QR code to pay ₹12,151.58 by UPI",
    className: "size-56",
  },
} satisfies Meta<typeof UpiQrCode>;

export default meta;

/** One SVG path drawn from the QR matrix, with a quiet zone; named for screen readers. */
export const Default: StoryObj<typeof meta> = {};
