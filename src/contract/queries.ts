/**
 * Query strings. Like bodies, they're parsed against these schemas before anything
 * reaches the domain, and one that doesn't parse is `invalid_request`. The same module
 * writes them, so the client and the server agree on every parameter's spelling.
 *
 * Paging follows Google AIP-158 (`pageSize`, `pageToken`, `nextPageToken`) and sorting
 * AIP-132 (`orderBy=createdAt desc`; ascending unless it says `desc`).
 */
import * as z from "@/core/zod";
import { ORDER_STATUSES, PAYMENT_METHODS } from "@/core/statuses";

export const ORDER_SORT_FIELDS = ["createdAt", "totalMinor", "buyerName", "ticketCount"] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface OrderBy {
  field: OrderSortField;
  isDescending: boolean;
}

export const DEFAULT_ORDER_BY: OrderBy = { field: "createdAt", isDescending: true };
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

const ORDER_BY_PATTERN = new RegExp(`^(${ORDER_SORT_FIELDS.join("|")})(?: (asc|desc))?$`);

export const orderBySchema = z
  .string()
  .regex(ORDER_BY_PATTERN, "Sort by createdAt, totalMinor, buyerName or ticketCount, then asc or desc.")
  .transform((text): OrderBy => {
    const [field, direction] = text.split(" ");
    return {
      field: ORDER_SORT_FIELDS.find((candidate) => candidate === field) ?? "createdAt",
      isDescending: direction === "desc",
    };
  });

/** The longest search the orders table takes. */
export const MAX_ORDER_SEARCH_LENGTH = 100;

const orderFiltersShape = {
  event: z.string().min(1).optional(),
  status: z.array(z.enum(ORDER_STATUSES)).default([]),
  method: z.enum(PAYMENT_METHODS).optional(),
  /** Calendar days in the organisation's time zone, inclusive. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().min(1).max(MAX_ORDER_SEARCH_LENGTH).optional(),
  orderBy: orderBySchema.optional().transform((orderBy) => orderBy ?? DEFAULT_ORDER_BY),
};

const datesInOrder = ({ from, to }: { from?: string | undefined; to?: string | undefined }) =>
  !from || !to || from <= to;
const DATES_IN_ORDER = { message: "The start date is after the end date.", path: ["from"] };

/** Which orders, in what order: the filters of the orders table and its CSV export. */
export const orderFiltersSchema = z.object(orderFiltersShape).refine(datesInOrder, DATES_IN_ORDER);

/** A page of those orders. */
export const orderListParamsSchema = z
  .object({
    ...orderFiltersShape,
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    pageToken: z.string().min(1).optional(),
  })
  .refine(datesInOrder, DATES_IN_ORDER);

export type OrderFilters = z.output<typeof orderFiltersSchema>;
export type OrderListParams = z.output<typeof orderListParamsSchema>;

/** A query string as the schemas read it: absent and empty are the same, and `status` may repeat. */
export function readOrderSearchParams(params: URLSearchParams) {
  const single = (name: string) => {
    const value = params.get(name);
    return value === null || value === "" ? undefined : value;
  };
  return {
    event: single("event"),
    status: params.getAll("status").filter(Boolean),
    method: single("method"),
    from: single("from"),
    to: single("to"),
    q: single("q"),
    orderBy: single("orderBy"),
    pageSize: single("pageSize"),
    pageToken: single("pageToken"),
  };
}

/**
 * Write filters (and a page) as a query string, canonically: defaults left out and
 * statuses sorted, so the same view always has the same URL.
 */
export function writeOrderSearchParams(
  filters: Partial<OrderFilters>,
  page: { pageSize?: number; pageToken?: string } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.event) params.set("event", filters.event);
  for (const status of [...(filters.status ?? [])].sort()) params.append("status", status);
  if (filters.method) params.set("method", filters.method);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  const { orderBy } = filters;
  if (orderBy && (orderBy.field !== DEFAULT_ORDER_BY.field || orderBy.isDescending !== DEFAULT_ORDER_BY.isDescending)) {
    params.set("orderBy", `${orderBy.field} ${orderBy.isDescending ? "desc" : "asc"}`);
  }
  if (page.pageSize !== undefined && page.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(page.pageSize));
  if (page.pageToken) params.set("pageToken", page.pageToken);
  return params;
}
