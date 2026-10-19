/**
 * Pricing: what a buyer pays, worked out once — for the server's charge, the order
 * summary and every price on screen — so the first price a buyer sees is the price
 * they pay. Showing a base price and adding fees later is "drip pricing", banned in
 * India by the CCPA's Guidelines for Prevention and Regulation of Dark Patterns (2023)
 * and, for live-event tickets in the US, by the FTC's Rule on Unfair or Deceptive Fees
 * (2025).
 *
 * Catalogue prices are before tax. The booking fee and GST are worked forward from
 * them per unit, in integer paise, rounding half-up — so one ticket's all-in price,
 * times the quantity, is exactly what that line costs.
 */
import type { CurrencyCode } from "./money";
import type { LineItem } from "./ticketing";

/**
 * Rates and thresholds, as data: GST changes (it did, on 22 September 2025), and a
 * change of rate should be a reviewable data change, not an edit to the arithmetic.
 */
export const PRICING_RULES = {
  /** Charged on each ticket, for booking it online. */
  bookingFeeBasisPoints: 300,
  /** GST on admission to concerts, theatre and other events: 18%, and none at all at ₹500 or less per person. */
  admissionGst: { rateBasisPoints: 1800, exemptUpToMinor: 50_000 },
  /** GST on the booking fee, which is a service: 18%. */
  serviceGstBasisPoints: 1800,
} as const;

/** "3%" */
export const BOOKING_FEE_LABEL = `${PRICING_RULES.bookingFeeBasisPoints / 100}%`;

/** All that pricing needs from an event. The catalogue's events and the API's both have it. */
export interface PricedEvent {
  slug: string;
  currency: CurrencyCode;
  tiers: readonly { id: string; priceMinor: number }[];
  addOns: readonly { id: string; priceMinor: number; gstRateBasisPoints: number }[];
}

export const TAX_LINE_KINDS = ["tickets", "tickets-exempt", "booking-fee", "add-ons"] as const;
export type TaxLineKind = (typeof TAX_LINE_KINDS)[number];

export interface TaxLine {
  kind: TaxLineKind;
  rateBasisPoints: number;
  /** What the rate applies to, before tax. */
  taxableMinor: number;
  amountMinor: number;
}

export interface Amounts {
  currency: CurrencyCode;
  ticketsMinor: number;
  addOnsMinor: number;
  /** Booking fees. */
  feesMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxLines: TaxLine[];
}

/** `amountMinor × basisPoints / 10,000`, rounded half-up, in integers only. */
const applyBasisPoints = (amountMinor: number, basisPoints: number) =>
  Math.floor((amountMinor * basisPoints + 5_000) / 10_000);

/**
 * GST is charged in two halves — CGST and SGST — each worked out and rounded on its
 * own, so neither is ever half a paisa: 18% of ₹74.97 is 1,349.46 paise, but two 9%
 * halves are 675 + 675 = 1,350.
 */
export const gstOn = (amountMinor: number, rateBasisPoints: number) =>
  2 * applyBasisPoints(amountMinor, rateBasisPoints / 2);

export interface TicketPrice {
  baseMinor: number;
  feeMinor: number;
  gstOnTicketMinor: number;
  gstOnFeeMinor: number;
  allInMinor: number;
  isGstExempt: boolean;
}

/** One ticket, priced in full. */
export function ticketPrice(baseMinor: number): TicketPrice {
  const { bookingFeeBasisPoints, admissionGst, serviceGstBasisPoints } = PRICING_RULES;
  const feeMinor = applyBasisPoints(baseMinor, bookingFeeBasisPoints);
  const isGstExempt = baseMinor <= admissionGst.exemptUpToMinor;
  const gstOnTicketMinor = isGstExempt ? 0 : gstOn(baseMinor, admissionGst.rateBasisPoints);
  const gstOnFeeMinor = gstOn(feeMinor, serviceGstBasisPoints);
  return {
    baseMinor,
    feeMinor,
    gstOnTicketMinor,
    gstOnFeeMinor,
    allInMinor: baseMinor + feeMinor + gstOnTicketMinor + gstOnFeeMinor,
    isGstExempt,
  };
}

function findPrice<T extends { id: string }>(event: PricedEvent, list: readonly T[], id: string, what: string): T {
  const found = list.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown ${what} ${id} for ${event.slug}`);
  return found;
}

/** One extra, with its GST: extras carry no booking fee. */
export const allInAddOnPriceMinor = (event: PricedEvent, addOnId: string) => {
  const addOn = findPrice(event, event.addOns, addOnId, "add-on");
  return addOn.priceMinor + gstOn(addOn.priceMinor, addOn.gstRateBasisPoints);
};

/** "From ₹…": the cheapest all-in ticket an event sells. */
export const lowestAllInPriceMinor = (event: PricedEvent) =>
  Math.min(...event.tiers.map((tier) => ticketPrice(tier.priceMinor).allInMinor));

/** The all-in price of one ticket in a tier: the number every price label shows. */
export const allInTicketPriceMinor = (event: PricedEvent, tierId: string) =>
  ticketPrice(findPrice(event, event.tiers, tierId, "tier").priceMinor).allInMinor;

/** A tax line per kind (and per rate, for add-ons), in a stable order, leaving out what didn't apply. */
function collectTaxLines(lines: TaxLine[]): TaxLine[] {
  const merged = new Map<string, TaxLine>();
  for (const line of lines) {
    const key = `${line.kind}:${String(line.rateBasisPoints)}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            taxableMinor: existing.taxableMinor + line.taxableMinor,
            amountMinor: existing.amountMinor + line.amountMinor,
          }
        : line,
    );
  }
  return [...merged.values()]
    .filter((line) => line.taxableMinor > 0)
    .sort(
      (left, right) =>
        TAX_LINE_KINDS.indexOf(left.kind) - TAX_LINE_KINDS.indexOf(right.kind) ||
        right.rateBasisPoints - left.rateBasisPoints,
    );
}

export function priceOrder(
  event: PricedEvent,
  items: readonly LineItem[],
  addOns: Readonly<Record<string, number>>,
): Amounts {
  const { admissionGst, serviceGstBasisPoints } = PRICING_RULES;
  let ticketsMinor = 0;
  let feesMinor = 0;
  let addOnsMinor = 0;
  const lines: TaxLine[] = [];

  for (const { tierId, quantity } of items) {
    const price = ticketPrice(findPrice(event, event.tiers, tierId, "tier").priceMinor);
    ticketsMinor += price.baseMinor * quantity;
    feesMinor += price.feeMinor * quantity;
    lines.push(
      price.isGstExempt
        ? { kind: "tickets-exempt", rateBasisPoints: 0, taxableMinor: price.baseMinor * quantity, amountMinor: 0 }
        : {
            kind: "tickets",
            rateBasisPoints: admissionGst.rateBasisPoints,
            taxableMinor: price.baseMinor * quantity,
            amountMinor: price.gstOnTicketMinor * quantity,
          },
      {
        kind: "booking-fee",
        rateBasisPoints: serviceGstBasisPoints,
        taxableMinor: price.feeMinor * quantity,
        amountMinor: price.gstOnFeeMinor * quantity,
      },
    );
  }

  for (const [addOnId, quantity] of Object.entries(addOns)) {
    if (quantity === 0) continue;
    const addOn = findPrice(event, event.addOns, addOnId, "add-on");
    addOnsMinor += addOn.priceMinor * quantity;
    lines.push({
      kind: "add-ons",
      rateBasisPoints: addOn.gstRateBasisPoints,
      taxableMinor: addOn.priceMinor * quantity,
      amountMinor: gstOn(addOn.priceMinor, addOn.gstRateBasisPoints) * quantity,
    });
  }

  const taxLines = collectTaxLines(lines);
  const taxMinor = taxLines.reduce((sum, line) => sum + line.amountMinor, 0);
  return {
    currency: event.currency,
    ticketsMinor,
    addOnsMinor,
    feesMinor,
    taxMinor,
    totalMinor: ticketsMinor + addOnsMinor + feesMinor + taxMinor,
    taxLines,
  };
}
