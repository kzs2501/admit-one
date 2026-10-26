/**
 * A hosted checkout's payments, as its provider reports them (Razorpay's, in server
 * mode). The provider's word arrives by webhook, or when the server asks it (after
 * Checkout's signed result, or on the scheduler's sweep); every way in settles here,
 * so a payment is settled once, whichever arrives first.
 *
 * The rule for money: a capture that can't become tickets goes back. The success path
 * decides whether a capture still can, by when it happened, as it does for every
 * webhook. A capture for an order that has moved on (paid another way, expired,
 * refunded), or for the wrong amount, is refunded without touching the order.
 * Settling never calls the provider: it says what to ask for, and the caller asks
 * once the change is committed.
 */
import type { BackendContext } from "./context";
import { isOrderOpen } from "./orders";
import { own } from "./state";
import { processPaymentSucceeded } from "./webhooks";

/** A payment as the provider reports it. */
export interface ObservedPayment {
  providerPaymentId: string;
  /** Authorised is money held at the bank, waiting to be captured; captured is money taken. */
  status: "authorized" | "captured" | "failed";
  amountMinor: number;
  currency: string;
  /** How the buyer paid on the provider's page: card, upi, netbanking… */
  instrument: string;
  last4: string | null;
  /** When the buyer paid, by the provider's clock: the hold is judged by it. */
  occurredAtMs: number;
}

/** What to ask the provider for, once the change that needs it is committed. */
export interface ProviderCommand {
  kind: "capture" | "refund";
  paymentId: string;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
}

export type SettleOutcome = "fulfilled" | "refunded" | "capturing" | "already-settled" | "noted";

export interface Settlement {
  outcome: SettleOutcome;
  commands: ProviderCommand[];
}

const settled = (outcome: SettleOutcome, commands: ProviderCommand[] = []): Settlement => ({ outcome, commands });

export function settleObservedPayment(
  context: BackendContext,
  paymentId: string,
  observed: ObservedPayment,
): Settlement {
  const payment = own(context.state.payments, paymentId);
  const order = payment ? context.state.orders[payment.orderId] : undefined;
  if (payment?.method !== "razorpay" || !order) {
    context.log("warn", `The provider reported on ${paymentId}, which isn't a checkout here; ignored.`);
    return settled("noted");
  }
  const command = (kind: ProviderCommand["kind"]): ProviderCommand => ({
    kind,
    paymentId: payment.id,
    providerPaymentId: observed.providerPaymentId,
    amountMinor: observed.amountMinor,
    currency: observed.currency,
  });

  // A duplicate, or the second of the ways in to arrive.
  const isSameProviderPayment = payment.providerPaymentId === observed.providerPaymentId;
  if (isSameProviderPayment && (payment.status === "succeeded" || payment.status === "refunded")) {
    return settled("already-settled");
  }
  if (observed.status === "failed") {
    // While it's open, Checkout lets the buyer try again (another card, UPI), so one
    // failed attempt doesn't end the payment: the checkout closing does.
    context.log("payment", `An attempt to pay ${payment.id} failed on the provider's page; the checkout stays open.`);
    return settled("noted");
  }

  const canBecomeTickets =
    isOrderOpen(order) &&
    order.paymentId === payment.id &&
    (payment.providerPaymentId === null || isSameProviderPayment) &&
    observed.amountMinor === payment.amountMinor &&
    observed.currency === order.amounts.currency;
  if (!canBecomeTickets) {
    // Money held but not taken is released by the provider in time; there's nothing to give back.
    if (observed.status === "authorized") return settled("noted");
    if (payment.providerPaymentId === null) {
      Object.assign(payment, {
        providerPaymentId: observed.providerPaymentId,
        instrument: observed.instrument,
        last4: observed.last4,
        status: "refunded",
      });
    }
    context.log("payment", `Refunding ${observed.providerPaymentId}: ${order.id} can't take it any more.`);
    return settled("refunded", [command("refund")]);
  }

  Object.assign(payment, {
    providerPaymentId: observed.providerPaymentId,
    instrument: observed.instrument,
    last4: observed.last4,
  });
  if (observed.status === "authorized") {
    if (payment.status === "processing") return settled("capturing");
    payment.status = "processing";
    return settled("capturing", [command("capture")]);
  }
  processPaymentSucceeded(context, payment, order, observed.occurredAtMs);
  // Paid after the hold ran out: the order says it's refunded, and now the money goes back.
  return payment.status === "refunded" ? settled("refunded", [command("refund")]) : settled("fulfilled");
}
