/**
 * The orders table's filters live in the URL, so a view can be shared, a reload keeps
 * it, and Back undoes a change. The API refuses a query it can't honour (a 422); the
 * page is more forgiving, because a URL may have been typed or trimmed: each filter
 * that doesn't make sense is dropped on its own, and the rest still apply.
 */
import * as z from "@/core/zod";
import { ORDER_STATUSES, PAYMENT_METHODS } from "@/core/statuses";
import {
  DEFAULT_ORDER_BY,
  MAX_ORDER_SEARCH_LENGTH,
  orderBySchema,
  writeOrderSearchParams,
  type OrderBy,
  type OrderFilters,
  type OrderSortField,
} from "@/contract/queries";

const parsed = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
};

const isoDate = z.iso.date();
const statusSchema = z.enum(ORDER_STATUSES);

export function filtersFromSearchParams(params: URLSearchParams): OrderFilters {
  const value = (name: string) => params.get(name) ?? undefined;
  const from = parsed(isoDate, value("from"));
  const to = parsed(isoDate, value("to"));
  const areDatesInOrder = !from || !to || from <= to;
  return {
    event: parsed(z.string().min(1), value("event")),
    status: [...new Set(params.getAll("status").flatMap((status) => parsed(statusSchema, status) ?? []))],
    method: parsed(z.enum(PAYMENT_METHODS), value("method")),
    from: areDatesInOrder ? from : undefined,
    to: areDatesInOrder ? to : undefined,
    q: parsed(z.string().trim().min(1).max(MAX_ORDER_SEARCH_LENGTH), value("q")),
    orderBy: parsed(orderBySchema, value("orderBy")) ?? DEFAULT_ORDER_BY,
  };
}

/** The same filters, written canonically: what the page's URL and the API's query both say. */
export const filtersToSearchParams = (filters: OrderFilters) => writeOrderSearchParams(filters);

export const hasAnyFilter = (filters: OrderFilters) =>
  Boolean(filters.event ?? filters.method ?? filters.from ?? filters.to ?? filters.q) || filters.status.length > 0;

/**
 * Sorting by a column: a new column starts with what's most useful first (newest,
 * largest, A to Z); the same column again flips it.
 */
export function nextOrderBy(current: OrderBy, field: OrderSortField): OrderBy {
  if (current.field === field) return { field, isDescending: !current.isDescending };
  return { field, isDescending: field !== "buyerName" };
}
