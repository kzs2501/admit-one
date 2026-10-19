/**
 * Sales metrics for an organiser: across their events, or for one. Ticket counts come
 * from the inventory, so they agree with the "left" on the event page. Money, days,
 * the funnel and webhook lag come from the orders — the same rows the orders table
 * lists.
 */
import { findTier, type EventInfo } from "@/core/catalog";
import { getOrganisation, type Account } from "@/core/organisations";
import type { CurrencyCode } from "@/core/money";
import type { OrderStatus, PaymentMethod } from "@/core/statuses";
import { nextDate, zonedDate, zonedDayStart } from "@/core/time";
import { eventFor, eventsFor } from "./access";
import type { BackendContext } from "./context";
import { ok, type Result } from "./errors";
import { getHistory, HISTORY_DAYS } from "./history";
import { soldQuantity } from "./inventory";
import { visibleRows } from "./reporting";

/** Orders whose money arrived — including those refunded since. */
const PAID_STATUSES: readonly OrderStatus[] = ["paid", "fulfilled", "refunded"];

export interface SalesMetrics {
  currency: CurrencyCode;
  timeZone: string;
  revenue: { grossMinor: number; refundedMinor: number; netMinor: number };
  tickets: { sold: number; capacity: number };
  tiers: { eventSlug: string; eventName: string; tierId: string; tierName: string; sold: number; capacity: number }[];
  paidOrders: number;
  averageOrderMinor: number;
  /** One entry per calendar day in the organisation's zone, oldest first, quiet days included. */
  salesByDay: { date: string; tickets: number; revenueMinor: number }[];
  /** Each stage counts orders that got at least that far, so it never widens. */
  funnel: { holds: number; orders: number; paid: number; fulfilled: number };
  paymentMethods: { method: PaymentMethod; orders: number }[];
  webhookLag: { p50Ms: number | null; p95Ms: number | null; samples: number };
}

/**
 * The value at or below which `percent` of the values fall: the nearest-rank method,
 * which always returns one of the values themselves (no interpolation).
 */
export function percentile(sortedAscending: readonly number[], percent: number): number | null {
  if (!sortedAscending.length) return null;
  const rank = Math.max(1, Math.ceil((percent / 100) * sortedAscending.length));
  return sortedAscending[rank - 1] ?? null;
}

/** The calendar days a history covers, through today, as each day's first instant in the zone. */
function daysOf(context: BackendContext, timeZone: string) {
  const dates: string[] = [];
  const today = zonedDate(context.deps.now(), timeZone);
  for (let date = zonedDate(context.state.createdAtMs - HISTORY_DAYS * 86_400_000, timeZone); ; date = nextDate(date)) {
    dates.push(date);
    if (date >= today) break;
  }
  return { dates, starts: dates.map((date) => zonedDayStart(date, timeZone)) };
}

/** The index of the last day starting at or before `atMs` (binary search), or -1 before the first. */
function dayIndex(starts: readonly number[], atMs: number) {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? Infinity) <= atMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export function salesMetrics(context: BackendContext, account: Account, eventSlug?: string): Result<SalesMetrics> {
  let events: readonly EventInfo[] = eventsFor(account);
  if (eventSlug !== undefined) {
    const access = eventFor(account, eventSlug);
    if (!access.ok) return access;
    events = [access.value];
  }
  const slugs = new Set(events.map((event) => event.slug));
  const rows = visibleRows(context, account, "orders:read").filter((row) => slugs.has(row.eventSlug));
  const paid = rows.filter((row) => PAID_STATUSES.includes(row.status));
  const { timeZone } = getOrganisation(account.organisationId);

  const grossMinor = paid.reduce((sum, row) => sum + row.amounts.totalMinor, 0);
  const refundedMinor = paid
    .filter((row) => row.status === "refunded")
    .reduce((sum, row) => sum + row.amounts.totalMinor, 0);

  const tiers = events.flatMap((event) =>
    event.tiers.map((tier) => ({
      eventSlug: event.slug,
      eventName: event.name,
      tierId: tier.id,
      tierName: tier.name,
      sold: soldQuantity(context, tier.id),
      capacity: tier.capacity,
    })),
  );

  const { dates, starts } = daysOf(context, timeZone);
  const salesByDay = dates.map((date) => ({ date, tickets: 0, revenueMinor: 0 }));
  for (const row of paid) {
    const day = salesByDay[dayIndex(starts, row.createdAtMs)];
    if (!day) continue;
    day.tickets += row.ticketCount;
    day.revenueMinor += row.amounts.totalMinor;
  }

  // Every order began as a hold; the history also remembers the holds that never became one.
  const history = getHistory();
  const abandonedHolds = [...slugs].reduce((sum, slug) => sum + (history.abandonedHolds[slug] ?? 0), 0);
  const sandboxHolds = Object.values(context.state.holds).filter((hold) => slugs.has(hold.eventSlug)).length;
  const historyOrders = history.orders.filter((order) => slugs.has(order.eventSlug)).length;
  // Other buyers buy outright, but every sale began as a hold.
  const liveSales = context.state.liveSales.filter((sale) => slugs.has(findTier(sale.tierId)?.event.slug ?? "")).length;

  const lags = paid.flatMap((row) => (row.webhookLagMs === null ? [] : [row.webhookLagMs])).sort((a, b) => a - b);

  return ok({
    currency: events[0]?.currency ?? "INR",
    timeZone,
    revenue: { grossMinor, refundedMinor, netMinor: grossMinor - refundedMinor },
    tickets: {
      sold: tiers.reduce((sum, tier) => sum + tier.sold, 0),
      capacity: tiers.reduce((sum, tier) => sum + tier.capacity, 0),
    },
    tiers,
    paidOrders: paid.length,
    averageOrderMinor: paid.length ? Math.round(grossMinor / paid.length) : 0,
    salesByDay,
    funnel: {
      holds: historyOrders + abandonedHolds + sandboxHolds + liveSales,
      orders: rows.length,
      paid: paid.length,
      fulfilled: rows.filter((row) => row.status === "fulfilled").length,
    },
    paymentMethods: (["upi", "card"] as const).map((method) => ({
      method,
      orders: paid.filter((row) => row.method === method).length,
    })),
    webhookLag: { p50Ms: percentile(lags, 50), p95Ms: percentile(lags, 95), samples: lags.length },
  });
}
