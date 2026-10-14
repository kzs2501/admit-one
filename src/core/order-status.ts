/**
 * Where an order stands, as the buyer's screens need to know it — one definition per
 * question, so the checkout and the order page can't disagree. (The backend has its
 * own rules for what may happen next; see `backend/domain/order-machine.ts`.)
 */
import type { OrderStatus, PaymentStatus } from "./statuses";

interface OrderProgress {
  status: OrderStatus;
  payment: { status: PaymentStatus } | null;
}

/** A charge is with the provider: its webhook will settle the order. Worth polling for. */
export const isAwaitingConfirmation = (order: OrderProgress) =>
  order.status === "paid" || (order.status === "pending" && order.payment?.status === "processing");

/** Money has moved — the checkout is over, whatever happens next. */
export const isPaidFor = (order: OrderProgress) =>
  order.status === "paid" || order.status === "fulfilled" || order.status === "refunded";

/** Still waiting on the buyer: nothing charged yet, a 3-D Secure check open, or a declined card. */
export const isAwaitingPayment = (order: OrderProgress) => order.status === "pending" && !isAwaitingConfirmation(order);
