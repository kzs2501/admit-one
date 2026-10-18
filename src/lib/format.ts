import type { SeatDto } from "@/contract/dto";
import type { CurrencyCode } from "@/core/money";
import { formatSeatList, seatLabel } from "@/core/seating";
import type { LineItem } from "@/core/ticketing";

/** The visitor-facing locale: the venues are in India, and so is the audience. */
const DISPLAY_LOCALE = "en-IN";

/** Event dates are shown in the venue's own time zone, whatever the visitor's is. */
export const formatEventDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));

export const formatEventTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(DISPLAY_LOCALE, { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(new Date(iso))
    .replace(/\s/, "\u00a0"); // a no-break space (whichever space Intl used), so "11:00 am" never wraps

const moneyFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

/** ₹2,575.00 — formatted from integer minor units, in the amount's own currency. */
export function formatMoney(amountMinor: number, currency: CurrencyCode) {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** minorDigits);
}

/** "2 × General, 1 × Workshop + General" */
export function describeItems(tiers: readonly { id: string; name: string }[], items: readonly LineItem[]) {
  return items
    .map(({ tierId, quantity }) => `${quantity} × ${tiers.find((tier) => tier.id === tierId)?.name ?? tierId}`)
    .join(", ");
}

const toSeatName = ({ sectionName, row, number }: SeatDto) => ({ sectionName, rowLabel: row, number });

/** A seat from the API, named the way a ticket prints it: "Stalls, row F, seat 12". */
export const formatSeat = (seat: SeatDto) => seatLabel(toSeatName(seat));

/** "Stalls F12–F14, G3" */
export const formatSeats = (seats: readonly SeatDto[]) => formatSeatList(seats.map(toSeatName));

const peopleFormatter = new Intl.NumberFormat(DISPLAY_LOCALE);

/** "40,000"; and in Indian grouping, "1,20,000". */
export const formatCount = (count: number) => peopleFormatter.format(count);

/**
 * A wait, said coarsely, because an estimate is an estimate: "less than a minute",
 * "about 3 minutes", "about an hour". Precise-but-wrong numbers erode trust faster
 * than honest ranges.
 */
export function formatWait(waitMs: number): string {
  const minutes = Math.round(waitMs / 60_000);
  if (waitMs < 60_000) return "less than a minute";
  if (minutes < 2) return "about a minute";
  if (minutes < 55) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
