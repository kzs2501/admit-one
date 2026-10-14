/**
 * The simulated provider's test cards, as a payment form's test mode offers them.
 * Shared by the payment step and the browser tests, so a label can't drift.
 */
export const TEST_CARD_OPTIONS = [
  { label: "Succeeds", number: "4242 4242 4242 4242" },
  { label: "Declined", number: "4000 0000 0000 0002" },
  { label: "Needs 3-D Secure", number: "4000 0025 0000 3155" },
] as const;

export type TestCardLabel = (typeof TEST_CARD_OPTIONS)[number]["label"];

export const TEST_CARD_EXPIRY = "12 / 30";
export const TEST_CARD_CVC = "123";
