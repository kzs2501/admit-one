/**
 * Money is integer minor units (cents) everywhere. Floats can't represent most cent
 * values exactly, and a checkout's numbers have to add up to the cent.
 */
import { catalog, type EventInfo } from "./catalog";
import type { Amounts, LineItem } from "@/contract/dto";

/** Service fee: 3% of the tickets and add-ons, rounded half-up to the cent. */
export const SERVICE_FEE_BASIS_POINTS = 300;

export function priceOrder(event: EventInfo, items: LineItem[], addOns: Record<string, number>): Amounts {
  const ticketsCents = items.reduce((sum, { tierId, qty }) => {
    const tier = event.tiers.find((t) => t.id === tierId);
    if (!tier) throw new Error(`Unknown tier ${tierId} for ${event.slug}`);
    return sum + tier.priceCents * qty;
  }, 0);

  const addOnsCents = Object.entries(addOns).reduce((sum, [id, qty]) => {
    const addOn = event.addOns.find((a) => a.id === id);
    if (!addOn) throw new Error(`Unknown add-on ${id} for ${event.slug}`);
    return sum + addOn.priceCents * qty;
  }, 0);

  // Integer arithmetic: (x * bp + 5000) / 10000, floored — half-up without floats.
  const feesCents = Math.floor(((ticketsCents + addOnsCents) * SERVICE_FEE_BASIS_POINTS + 5000) / 10000);

  return { ticketsCents, addOnsCents, feesCents, totalCents: ticketsCents + addOnsCents + feesCents };
}

const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatMoney = (cents: number) => formatter.format(cents / 100);

export const ticketCount = (items: LineItem[]) => items.reduce((n, i) => n + i.qty, 0);

/** "2 × General, 1 × Workshop + General" */
export function describeItems(eventSlug: string, items: LineItem[]) {
  const event = catalog.find((e) => e.slug === eventSlug);
  return items
    .map(({ tierId, qty }) => `${qty} × ${event?.tiers.find((t) => t.id === tierId)?.name ?? tierId}`)
    .join(", ");
}
