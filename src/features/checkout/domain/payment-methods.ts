/**
 * The ways to pay, as a registry — like the checkout's steps. Each method says when
 * it's offered; the payment step shows whatever is offered for this order. Adding one
 * (net banking, a wallet) is a new entry and its view, not a rewrite of the step.
 */
import type { OrderDto } from "@/contract/dto";
import type { PaymentMethod } from "@/core/statuses";
import { isServerMode } from "@/lib/backend-mode";

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  hint: string;
  isOffered: (order: OrderDto) => boolean;
}

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = [
  { id: "card", label: "Card", hint: "Credit or debit card", isOffered: () => true },
  {
    id: "upi",
    label: "UPI",
    hint: "Any UPI app — scan a QR code, or open the app on this phone",
    // On the server, UPI comes with a real provider: there's no simulated phone to approve it on.
    isOffered: (order) => order.amounts.currency === "INR" && !isServerMode,
  },
];

export const offeredPaymentMethods = (order: OrderDto) =>
  PAYMENT_METHOD_OPTIONS.filter((option) => option.isOffered(order));

/** The method to show: the buyer's choice if it's offered for this order, otherwise card, which always is. */
export function chosenPaymentMethod(order: OrderDto, choice: PaymentMethod | undefined): PaymentMethod {
  return offeredPaymentMethods(order).some((option) => option.id === choice) && choice ? choice : "card";
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
