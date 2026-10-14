import type { LineItem } from "@/core/ticketing";

/** Event dates are shown in the venue's own time zone, whatever the visitor's is. */
const VENUE_TZ = "Asia/Kolkata";

export const formatEventDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: VENUE_TZ,
  }).format(new Date(iso));

export const formatEventTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: VENUE_TZ })
    .format(new Date(iso))
    .replace(" ", " ");

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatMoney = (cents: number) => moneyFormatter.format(cents / 100);

/** "2 × General, 1 × Workshop + General" */
export function describeItems(tiers: readonly { id: string; name: string }[], items: readonly LineItem[]) {
  return items
    .map(({ tierId, quantity }) => `${quantity} × ${tiers.find((tier) => tier.id === tierId)?.name ?? tierId}`)
    .join(", ");
}
