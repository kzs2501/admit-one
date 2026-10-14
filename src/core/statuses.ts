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
export type HoldStatus = (typeof HOLD_STATUSES)[number];
