/**
 * UPI, India's real-time payment system. A merchant can no longer "collect" — send a
 * request to a buyer's UPI ID — since NPCI withdrew collect for merchant payments on
 * 28 February 2026. The buyer pays by intent instead: a `upi://pay` link that opens
 * their UPI app on a phone, or the same link as a QR code to scan from a computer.
 */
import { toDecimalString } from "@/core/money";
import type { PaymentRecord } from "./state";

/**
 * Who's being paid. The handle `@example` belongs to no bank, so a real UPI app can't
 * pay this address — even if someone scans the demo's QR code.
 */
export const UPI_PAYEE = {
  address: "dresscircle@example",
  name: "Dress Circle",
  /** Merchant category code 7922: theatrical producers and ticket agencies. */
  merchantCategoryCode: "7922",
} as const;

/** `303729` paise → `"3037.29"`: always two decimal places, worked out without floats. */
export const formatUpiAmount = toDecimalString;

// Percent-encoded, spaces as %20 (never "+"); `@` stays readable in an address, as in
// the linking specification's own examples.
const encode = (value: string) => encodeURIComponent(value).replaceAll("%40", "@");

export interface UpiIntentInput {
  paymentId: string;
  orderId: string;
  /** In paise: UPI is rupees only. */
  amountMinor: number;
}

/**
 * The intent link, per NPCI's UPI linking specification. A merchant payment must
 * carry its category code (`mc`) and a reference unique to the transaction (`tr`):
 * the payment's id, so the provider's confirmation can be matched to it.
 */
export function buildUpiIntent({ paymentId, orderId, amountMinor }: UpiIntentInput): string {
  const params = [
    ["pa", UPI_PAYEE.address],
    ["pn", UPI_PAYEE.name],
    ["mc", UPI_PAYEE.merchantCategoryCode],
    ["tr", paymentId],
    ["tn", `Dress Circle order ${orderId}`],
    ["am", formatUpiAmount(amountMinor)],
    ["cu", "INR"],
  ] as const;
  return `upi://pay?${params.map(([name, value]) => `${name}=${encode(value)}`).join("&")}`;
}

/**
 * A UPI request that nobody approved in time has failed. Like a hold's expiry, it's
 * worked out when read — nothing runs on a timer — and written down by the next
 * command that touches the order.
 */
export const isUpiRequestExpired = (payment: PaymentRecord, nowMs: number) =>
  payment.method === "upi" && payment.status === "requires_action" && nowMs >= payment.expiresAtMs;
