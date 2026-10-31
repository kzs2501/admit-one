/**
 * The ways to pay, as a registry — like the checkout's steps. The backend says which
 * are offered for an order; the payment step shows those. Adding one (net banking, a
 * wallet) is a new entry and its view, not a rewrite of the step.
 */
import type { OrderDto } from "@/contract/dto";
import type { PaymentMethod } from "@/core/statuses";

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  hint: string;
}

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = [
  { id: "card", label: "Card", hint: "Credit or debit card" },
  { id: "upi", label: "UPI", hint: "Any UPI app: scan a QR code, or open the app on this phone" },
  { id: "razorpay", label: "Razorpay", hint: "Card, net banking or a wallet, on Razorpay’s secure checkout" },
];

/** The ways to pay this order, as the backend offers them: its provider decides, not this page. */
export const offeredPaymentMethods = (order: OrderDto) =>
  PAYMENT_METHOD_OPTIONS.filter((option) => order.paymentMethods.includes(option.id));

/** The method to show: the buyer's choice if it's offered for this order, otherwise the first that is. */
export function chosenPaymentMethod(order: OrderDto, choice: PaymentMethod | undefined): PaymentMethod {
  const offered = offeredPaymentMethods(order);
  return offered.find((option) => option.id === choice)?.id ?? offered[0]?.id ?? "card";
}

export interface PendingUpiRequest {
  paymentId: string;
  intentUri: string;
  expiresAt: string;
}

/** The UPI request waiting for the buyer to approve in their app, if there is one. */
export function pendingUpiRequest(order: OrderDto): PendingUpiRequest | null {
  const { payment } = order;
  if (payment?.status !== "requires_action" || payment.nextAction?.type !== "upi") return null;
  return { paymentId: payment.id, intentUri: payment.nextAction.intentUri, expiresAt: payment.nextAction.expiresAt };
}

/** How the last UPI payment ended without paying, if it did — in words for the buyer. */
export function upiOutcome(order: OrderDto): { tone: "bad" | "info"; title: string; message: string } | null {
  const { payment } = order;
  if (order.status !== "failed" || payment?.method !== "upi") return null;
  switch (payment.failureCode) {
    case "upi_declined":
      return {
        tone: "bad",
        title: "UPI payment declined",
        message: "It was declined in your UPI app. No money was taken.",
      };
    case "upi_expired":
      return {
        tone: "bad",
        title: "UPI request expired",
        message: "Nobody approved it in time. No money was taken.",
      };
    case "cancelled":
      return { tone: "info", title: "UPI request cancelled", message: "Pay with UPI again, or choose another way." };
    default:
      return null;
  }
}

export interface PendingRazorpayCheckout {
  paymentId: string;
  keyId: string;
  /** Razorpay's order, which the checkout pays. */
  orderId: string;
  amountMinor: number;
  currency: string;
  expiresAt: string;
}

/** The Razorpay checkout waiting for the buyer to pay, if there is one. */
export function pendingRazorpayCheckout(order: OrderDto): PendingRazorpayCheckout | null {
  const { payment } = order;
  if (payment?.status !== "requires_action" || payment.nextAction?.type !== "razorpay_checkout") return null;
  const { keyId, orderId, amountMinor, currency, expiresAt } = payment.nextAction;
  return { paymentId: payment.id, keyId, orderId, amountMinor, currency, expiresAt };
}

/** How the last Razorpay checkout ended without paying, if it did — in words for the buyer. */
export function checkoutOutcome(order: OrderDto): { tone: "bad" | "info"; title: string; message: string } | null {
  const { payment } = order;
  if (order.status !== "failed" || payment?.method !== "razorpay") return null;
  switch (payment.failureCode) {
    case "checkout_expired":
      return { tone: "bad", title: "The checkout closed", message: "Nothing was paid in time. No money was taken." };
    case "cancelled":
      return { tone: "info", title: "Checkout closed", message: "Nothing was paid. Pay again whenever you’re ready." };
    default:
      return null;
  }
}
