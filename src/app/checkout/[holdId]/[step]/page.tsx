import type { Metadata } from "next";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

/** The step is read from the URL by the layout's CheckoutFlow; nothing renders here. */
export default function CheckoutStepPage() {
  return null;
}
