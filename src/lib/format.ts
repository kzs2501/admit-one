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
