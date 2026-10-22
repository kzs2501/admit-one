/**
 * What an organiser can ask about their orders: one list, merged from the generated
 * history and this sandbox's own orders, filtered, sorted and paged on the server.
 *
 * Pages are keyset pages (Google AIP-158): a page token remembers the last row's sort
 * key and id, and the next page starts strictly after it. Unlike an offset, new orders
 * arriving between pages can't push a row onto two pages or skip one. Tokens are
 * opaque, and they're bound to their query: a token used with other filters is refused
 * rather than silently giving the wrong rows.
 */
import { own } from "./state";
import { z } from "@/core/zod";
import type { OrderBy, OrderSortField } from "@/contract/queries";
import { findEvent, getEvent } from "@/core/catalog";
import { can, getOrganisation, type Account, type Permission } from "@/core/organisations";
import type { Amounts } from "@/core/pricing";
import type { OrderStatus, PaymentMethod, RefundStatus } from "@/core/statuses";
import { nextDate, zonedDayStart } from "@/core/time";
import { ticketCount } from "@/core/ticketing";
import { eventFor } from "./access";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";
import { findHistoricalOrder, getHistory, otherBuyer, type HistoricalOrder } from "./history";
import { resolveOrderStatus } from "./orders";
import { findTier } from "@/core/catalog";
import { priceOrder } from "@/core/pricing";
import type { LiveSale, OrderRecord, RefundRecord } from "./state";

/** One order, as a row in the organiser's table. */
export interface OrderRow {
  id: string;
  eventSlug: string;
  createdAtMs: number;
  buyerName: string;
  buyerEmail: string;
  ticketCount: number;
  amounts: Amounts;
  status: OrderStatus;
  method: PaymentMethod | null;
  /** For orders that were paid: how long the provider's webhook took. */
  webhookLagMs: number | null;
  /** A refund asked for: on its way, or done. */
  refundStatus: RefundStatus | null;
}

export interface OrderQuery {
  event?: string | undefined;
  status: readonly OrderStatus[];
  method?: PaymentMethod | undefined;
  /** Calendar days in the organisation's time zone, inclusive. */
  from?: string | undefined;
  to?: string | undefined;
  /** Matches an order id, or part of a buyer's name or email. */
  q?: string | undefined;
  orderBy: OrderBy;
}

export interface OrderPage {
  rows: OrderRow[];
  nextPageToken: string | null;
  totalSize: number;
}

/** Refunds by order: what an organiser has done to an order since it was placed. */
const refundsOf = (context: BackendContext) =>
  new Map(Object.values(context.state.refunds).map((refund) => [refund.orderId, refund]));

/** History is generated, so a refund since is laid over it: once it's gone through, the order is refunded. */
const fromHistory = (order: HistoricalOrder, createdAtMs: number, refund: RefundRecord | undefined): OrderRow => ({
  id: order.id,
  eventSlug: order.eventSlug,
  createdAtMs: createdAtMs - order.agoMs,
  buyerName: order.buyer.name,
  buyerEmail: order.buyer.email,
  ticketCount: order.quantity,
  amounts: order.amounts,
  status: refund?.status === "succeeded" ? "refunded" : order.status,
  method: order.method,
  webhookLagMs: order.webhookLagMs,
  refundStatus: refund?.status ?? null,
});

/** Other buyers' orders are `ord_l` and their sale's number. */
export const liveSaleOrderId = (sale: LiveSale) => `ord_l${String(sale.seq).padStart(5, "0")}`;

const priced = new Map<string, Amounts>();

function fromLiveSale(sale: LiveSale, refund: RefundRecord | undefined): OrderRow {
  const found = findTier(sale.tierId);
  const eventSlug = found?.event.slug ?? "";
  const key = `${sale.tierId}:${String(sale.quantity)}`;
  const amounts =
    priced.get(key) ?? priceOrder(getEvent(eventSlug), [{ tierId: sale.tierId, quantity: sale.quantity }], {});
  priced.set(key, amounts);
  const buyer = otherBuyer(sale.seq);
  return {
    id: liveSaleOrderId(sale),
    eventSlug,
    createdAtMs: sale.atMs,
    buyerName: buyer.name,
    buyerEmail: buyer.email,
    ticketCount: sale.quantity,
    amounts,
    status: refund?.status === "succeeded" ? "refunded" : "fulfilled",
    method: buyer.method,
    webhookLagMs: buyer.webhookLagMs,
    refundStatus: refund?.status ?? null,
  };
}

export const findLiveSale = (context: BackendContext, orderId: string) =>
  context.state.liveSales.find((sale) => liveSaleOrderId(sale) === orderId);

function fromSandbox(context: BackendContext, order: OrderRecord, refund: RefundRecord | undefined): OrderRow {
  const buyer = order.attendees[0];
  const payment = order.paymentId ? context.state.payments[order.paymentId] : undefined;
  return {
    id: order.id,
    eventSlug: order.eventSlug,
    createdAtMs: order.createdAtMs,
    buyerName: buyer?.name ?? "",
    buyerEmail: buyer?.email ?? "",
    ticketCount: ticketCount(order.items),
    amounts: order.amounts,
    status: resolveOrderStatus(context, order).status,
    method: payment?.method ?? null,
    webhookLagMs: payment?.webhookLagMs ?? null,
    refundStatus: refund?.status ?? null,
  };
}

/** Every order this account may see for this permission: the history, then this sandbox's. */
export function visibleRows(context: BackendContext, account: Account, permission: Permission): OrderRow[] {
  const isVisible = (row: { eventSlug: string }) => can(account, permission, getEvent(row.eventSlug));
  const refunds = refundsOf(context);
  return [
    ...getHistory()
      .orders.filter(isVisible)
      .map((order) => fromHistory(order, context.state.createdAtMs, refunds.get(order.id))),
    ...Object.values(context.state.orders)
      .filter(isVisible)
      .map((order) => fromSandbox(context, order, refunds.get(order.id))),
    ...context.state.liveSales.map((sale) => fromLiveSale(sale, refunds.get(liveSaleOrderId(sale)))).filter(isVisible),
  ];
}

const collator = new Intl.Collator("en-IN", { sensitivity: "base" });

const sortValue = (row: OrderRow, field: OrderSortField): number | string =>
  field === "createdAt"
    ? row.createdAtMs
    : field === "totalMinor"
      ? row.amounts.totalMinor
      : field === "buyerName"
        ? row.buyerName
        : row.ticketCount;

/** Compare by the sort field, then by id, so no two rows ever tie and every row has one place. */
function compareKeys(left: [number | string, string], right: [number | string, string], isDescending: boolean) {
  const [leftValue, leftId] = left;
  const [rightValue, rightId] = right;
  const byValue =
    typeof leftValue === "string" && typeof rightValue === "string"
      ? collator.compare(leftValue, rightValue)
      : Number(leftValue) - Number(rightValue);
  const byId = leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  return (isDescending ? -1 : 1) * (byValue || byId);
}

function matches(row: OrderRow, query: OrderQuery, range: { fromMs: number; toMs: number }) {
  if (query.event && row.eventSlug !== query.event) return false;
  if (query.status.length && !query.status.includes(row.status)) return false;
  if (query.method && row.method !== query.method) return false;
  if (row.createdAtMs < range.fromMs || row.createdAtMs >= range.toMs) return false;
  if (query.q) {
    const needle = query.q.toLocaleLowerCase("en-IN");
    return [row.id, row.buyerName, row.buyerEmail].some((text) => text.toLocaleLowerCase("en-IN").includes(needle));
  }
  return true;
}

/** The date range as instants: from the start of `from` to the start of the day after `to`, in the organisation's zone. */
function rangeOf(query: OrderQuery, account: Account) {
  const { timeZone } = getOrganisation(account.organisationId);
  return {
    fromMs: query.from ? zonedDayStart(query.from, timeZone) : -Infinity,
    toMs: query.to ? zonedDayStart(nextDate(query.to), timeZone) : Infinity,
  };
}

/** FNV-1a: a short, stable fingerprint of the query a token belongs to. */
function fingerprint(query: OrderQuery) {
  const { orderBy, ...filters } = query;
  const canonical = JSON.stringify({ ...filters, status: [...filters.status].sort(), orderBy });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) hash = Math.imul(hash ^ canonical.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** Where a page ended, and which query it belongs to. Parsed like any other untrusted input. */
const pageCursorSchema = z.object({
  after: z.tuple([z.union([z.number(), z.string()]), z.string()]),
  query: z.string(),
});
type PageCursor = z.infer<typeof pageCursorSchema>;

/** base64url of UTF-8 JSON: URL-safe, opaque to clients, and fine with any name in it. */
function encodeCursor(cursor: PageCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(token: string): PageCursor | null {
  try {
    const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    const parsed = pageCursorSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // not base64, or not JSON
  }
}

/** The matching orders, in order — every one, for exporting; `listOrders` pages through the same list. */
export function queryOrders(
  context: BackendContext,
  account: Account,
  query: OrderQuery,
  permission: Permission = "orders:read",
): Result<OrderRow[]> {
  if (query.event) {
    const access = eventFor(account, query.event, permission);
    if (!access.ok) return access;
  }
  const range = rangeOf(query, account);
  const { field, isDescending } = query.orderBy;
  const rows = visibleRows(context, account, permission)
    .filter((row) => matches(row, query, range))
    .sort((left, right) =>
      compareKeys([sortValue(left, field), left.id], [sortValue(right, field), right.id], isDescending),
    );
  return ok(rows);
}

export function listOrders(
  context: BackendContext,
  account: Account,
  query: OrderQuery,
  page: { pageSize: number; pageToken?: string | undefined },
): Result<OrderPage> {
  const queryKey = fingerprint(query);
  const cursor = page.pageToken === undefined ? null : decodeCursor(page.pageToken);
  if (page.pageToken !== undefined && cursor?.query !== queryKey) {
    return fail({
      code: "invalid_request",
      detail: "That page token belongs to a different query. Start again from the first page.",
    });
  }
  const result = queryOrders(context, account, query);
  if (!result.ok) return result;
  const rows = result.value;
  const { field, isDescending } = query.orderBy;
  const start = cursor
    ? rows.findIndex((row) => compareKeys([sortValue(row, field), row.id], cursor.after, isDescending) > 0)
    : 0;
  const pageRows = start === -1 ? [] : rows.slice(start, start + page.pageSize);
  const last = pageRows.at(-1);
  const hasMore = start !== -1 && start + page.pageSize < rows.length;
  return ok({
    rows: pageRows,
    nextPageToken: hasMore && last ? encodeCursor({ after: [sortValue(last, field), last.id], query: queryKey }) : null,
    totalSize: rows.length,
  });
}

/**
 * What's happened to an event's orders in this sandbox, as a short string: when it
 * changes, something an organiser would want to see did. The history never changes,
 * so it isn't part of it.
 */
export function activityOf(context: BackendContext, eventSlug: string): string {
  const { state } = context;
  const orders = Object.values(state.orders)
    .filter((order) => order.eventSlug === eventSlug)
    .map((order) => `${order.id}:${resolveOrderStatus(context, order).status}`);
  const refunds = Object.values(state.refunds)
    .filter((refund) => refund.eventSlug === eventSlug)
    .map((refund) => `${refund.id}:${refund.status}`);
  const liveSales = state.liveSales.filter((sale) => findTier(sale.tierId)?.event.slug === eventSlug).length;
  return [orders.join(","), refunds.join(","), String(liveSales)].join("|");
}

/** One order, in full, for its organiser. Another organiser's order is simply not found. */
export interface OrganiserOrder extends OrderRow {
  items: { tierId: string; quantity: number }[];
  seatIds: readonly string[];
  addOns: Readonly<Record<string, number>>;
  attendees: { name: string; email: string }[];
  last4: string | null;
  refunds: RefundRecord[];
}

export function findOrganiserOrder(context: BackendContext, account: Account, orderId: string): Result<OrganiserOrder> {
  const notFound = fail({ code: "not_found", detail: "That order doesn’t exist." });
  const historical = findHistoricalOrder(orderId);
  const sandboxOrder = own(context.state.orders, orderId);
  const liveSale = findLiveSale(context, orderId);
  const eventSlug =
    historical?.eventSlug ?? sandboxOrder?.eventSlug ?? (liveSale && findTier(liveSale.tierId)?.event.slug);
  const event = eventSlug === undefined ? undefined : findEvent(eventSlug);
  if (!event || !can(account, "orders:read", event)) return notFound;
  const refund = refundsOf(context).get(orderId);
  const refunds = refund ? [refund] : [];

  if (historical) {
    return ok({
      ...fromHistory(historical, context.state.createdAtMs, refund),
      items: [{ tierId: historical.tierId, quantity: historical.quantity }],
      seatIds: historical.seatIds,
      addOns: historical.addOns,
      attendees: [historical.buyer],
      last4: historical.last4,
      refunds,
    });
  }
  if (liveSale) {
    const buyer = otherBuyer(liveSale.seq);
    return ok({
      ...fromLiveSale(liveSale, refund),
      items: [{ tierId: liveSale.tierId, quantity: liveSale.quantity }],
      seatIds: liveSale.seatIds,
      addOns: {},
      attendees: [{ name: buyer.name, email: buyer.email }],
      last4: buyer.last4,
      refunds,
    });
  }
  if (!sandboxOrder) return notFound;
  const payment = sandboxOrder.paymentId ? context.state.payments[sandboxOrder.paymentId] : undefined;
  return ok({
    ...fromSandbox(context, sandboxOrder, refund),
    items: sandboxOrder.items,
    seatIds: context.state.holds[sandboxOrder.holdId]?.seatIds ?? [],
    addOns: sandboxOrder.addOns,
    attendees: sandboxOrder.attendees,
    last4: payment?.method === "card" ? payment.last4 : null,
    refunds,
  });
}
