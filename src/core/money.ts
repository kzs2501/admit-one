/**
 * Money is an amount in integer minor units (paise, cents) together with its
 * currency — Fowler's Money pattern. Floats can't represent most minor-unit values
 * exactly, and a checkout's numbers have to add up to the last paisa. The currency
 * travels with the amounts, so nothing has to assume one.
 */
import type { LineItem } from "./ticketing";

/** ISO 4217 codes the catalogue uses. */
export const CURRENCIES = ["INR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export type Amounts = {
  currency: CurrencyCode;
  ticketsMinor: number;
  addOnsMinor: number;
  feesMinor: number;
  totalMinor: number;
};

/** Service fee: 3% of the tickets and add-ons, rounded half-up to the minor unit. */
export const SERVICE_FEE_BASIS_POINTS = 300;

/** "3%" */
export const SERVICE_FEE_LABEL = `${SERVICE_FEE_BASIS_POINTS / 100}%`;

/** All that pricing needs from an event: its prices. Both the catalogue and the API's events have them. */
export type PricedEvent = {
  slug: string;
  currency: CurrencyCode;
  tiers: readonly { id: string; priceMinor: number }[];
  addOns: readonly { id: string; priceMinor: number }[];
};

export function priceOrder(
  event: PricedEvent,
  items: readonly LineItem[],
  addOns: Readonly<Record<string, number>>,
): Amounts {
  const ticketsMinor = items.reduce((sum, { tierId, quantity }) => {
    const tier = event.tiers.find((candidate) => candidate.id === tierId);
    if (!tier) throw new Error(`Unknown tier ${tierId} for ${event.slug}`);
    return sum + tier.priceMinor * quantity;
  }, 0);

  const addOnsMinor = Object.entries(addOns).reduce((sum, [addOnId, quantity]) => {
    const addOn = event.addOns.find((candidate) => candidate.id === addOnId);
    if (!addOn) throw new Error(`Unknown add-on ${addOnId} for ${event.slug}`);
    return sum + addOn.priceMinor * quantity;
  }, 0);

  // Integer arithmetic: (x * bp + 5000) / 10000, floored — half-up without floats.
  const feesMinor = Math.floor(((ticketsMinor + addOnsMinor) * SERVICE_FEE_BASIS_POINTS + 5000) / 10000);

  return {
    currency: event.currency,
    ticketsMinor,
    addOnsMinor,
    feesMinor,
    totalMinor: ticketsMinor + addOnsMinor + feesMinor,
  };
}
