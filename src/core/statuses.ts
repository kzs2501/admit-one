/**
 * The lifecycle vocabularies shared by the backend, the contract and the UI. Each is a
 * readonly tuple, so it can feed a Zod enum and a TypeScript union from one list.
 */
export const ORDER_STATUSES = ["pending", "paid", "fulfilled", "failed", "expired", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["processing", "requires_action", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_FAILURE_CODES = ["card_declined", "authentication_failed"] as const;
export type PaymentFailureCode = (typeof PAYMENT_FAILURE_CODES)[number];

export const HOLD_STATUSES = ["active", "expired", "converted"] as const;

/** A place in a sale's waiting room: in line, let in (for a while), or past its turn. */
export const QUEUE_STATUSES = ["waiting", "admitted", "expired"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export type HoldStatus = (typeof HOLD_STATUSES)[number];
