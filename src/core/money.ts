/**
 * Money is an amount in integer minor units (paise, cents) together with its
 * currency — Fowler's Money pattern. Floats can't represent most minor-unit values
 * exactly, and a checkout's numbers have to add up to the last paisa. The currency
 * travels with the amounts, so nothing has to assume one.
 */
/** ISO 4217 codes the catalogue uses. */
export const CURRENCIES = ["INR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** `303729` → `"3037.29"`: an amount as a plain decimal, for machines (a UPI link, a spreadsheet), without floats. */
export function toDecimalString(amountMinor: number) {
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  return `${String(major)}.${String(minor).padStart(2, "0")}`;
}
