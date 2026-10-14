/**
 * Money is integer minor units (cents) everywhere. Floats can't represent most cent
 * values exactly, and a checkout's numbers have to add up to the cent.
 */
import type { LineItem } from "./ticketing";

export type Amounts = {
  ticketsCents: number;
  addOnsCents: number;
  feesCents: number;
  totalCents: number;
};

/** Service fee: 3% of the tickets and add-ons, rounded half-up to the cent. */
export const SERVICE_FEE_BASIS_POINTS = 300;

/** "3%" */
export const SERVICE_FEE_LABEL = `${SERVICE_FEE_BASIS_POINTS / 100}%`;

/** All that pricing needs from an event: its prices. Both the catalogue and the API's events have them. */
export type PricedEvent = {
  slug: string;
  tiers: readonly { id: string; priceCents: number }[];
  addOns: readonly { id: string; priceCents: number }[];
};

export function priceOrder(
  event: PricedEvent,
  items: readonly LineItem[],
  addOns: Readonly<Record<string, number>>,
): Amounts {
  const ticketsCents = items.reduce((sum, { tierId, quantity }) => {
    const tier = event.tiers.find((candidate) => candidate.id === tierId);
    if (!tier) throw new Error(`Unknown tier ${tierId} for ${event.slug}`);
    return sum + tier.priceCents * quantity;
  }, 0);

  const addOnsCents = Object.entries(addOns).reduce((sum, [addOnId, quantity]) => {
    const addOn = event.addOns.find((candidate) => candidate.id === addOnId);
    if (!addOn) throw new Error(`Unknown add-on ${addOnId} for ${event.slug}`);
    return sum + addOn.priceCents * quantity;
  }, 0);

  // Integer arithmetic: (x * bp + 5000) / 10000, floored — half-up without floats.
  const feesCents = Math.floor(((ticketsCents + addOnsCents) * SERVICE_FEE_BASIS_POINTS + 5000) / 10000);

  return { ticketsCents, addOnsCents, feesCents, totalCents: ticketsCents + addOnsCents + feesCents };
}
