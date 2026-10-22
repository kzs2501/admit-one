/**
 * The organisers' API, as the dashboard calls it. Every call carries the session's
 * bearer token; a 401 means the session is over, so the token is forgotten and the
 * dashboard goes back to signing in.
 */
import { z } from "@/core/zod";
import type { RefundReason } from "@/core/statuses";
import {
  accountDtoSchema,
  doorListDtoSchema,
  orderPageDtoSchema,
  organiserEventDtoSchema,
  organiserOrderDtoSchema,
  refundResultDtoSchema,
  salesMetricsDtoSchema,
  sessionDtoSchema,
} from "@/contract/dto";
import { writeOrderSearchParams, type OrderFilters } from "@/contract/queries";
import { API_ROUTES, AUTHORIZATION_HEADER, buildApiPath, IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { post, problemOf, request, requestFile } from "./api-client";
import { readOrganiserToken, saveOrganiserToken } from "./organiser-session";

/** The session's token, as headers; none if signed out (and the server will say 401). */
export function authorization(): Record<string, string> {
  const token = readOrganiserToken();
  return token ? { [AUTHORIZATION_HEADER]: `Bearer ${token}` } : {};
}

async function asOrganiser<T>(call: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  try {
    return await call(authorization());
  } catch (error) {
    if (problemOf(error)?.code === "unauthenticated") saveOrganiserToken(null);
    throw error;
  }
}

const withQuery = (path: string, params: URLSearchParams) => (params.size ? `${path}?${params.toString()}` : path);

export const organiserApi = {
  signIn: (accountId: string) => post(buildApiPath(API_ROUTES.session, {}), sessionDtoSchema, { accountId }),
  signOut: () =>
    fetch(buildApiPath(API_ROUTES.session, {}), { method: "DELETE", headers: authorization() }).catch(() => undefined),
  getAccount: () =>
    asOrganiser((headers) => request(buildApiPath(API_ROUTES.organiserAccount, {}), accountDtoSchema, { headers })),
  listEvents: () =>
    asOrganiser((headers) =>
      request(buildApiPath(API_ROUTES.organiserEvents, {}), z.array(organiserEventDtoSchema), { headers }),
    ),
  /** The codes of an event's refunded tickets, for its door scanner. */
  getDoorList: (eventSlug: string) =>
    asOrganiser((headers) =>
      request(buildApiPath(API_ROUTES.organiserDoor, { slug: eventSlug }), doorListDtoSchema, { headers }),
    ),
  getMetrics: (eventSlug?: string) =>
    asOrganiser((headers) =>
      request(
        withQuery(
          buildApiPath(API_ROUTES.organiserMetrics, {}),
          new URLSearchParams(eventSlug ? { event: eventSlug } : {}),
        ),
        salesMetricsDtoSchema,
        { headers },
      ),
    ),
  listOrders: (filters: OrderFilters, pageToken?: string) =>
    asOrganiser((headers) =>
      request(
        withQuery(
          buildApiPath(API_ROUTES.organiserOrders, {}),
          writeOrderSearchParams(filters, pageToken === undefined ? { pageSize: 100 } : { pageSize: 100, pageToken }),
        ),
        orderPageDtoSchema,
        { headers },
      ),
    ),
  getOrder: (orderId: string) =>
    asOrganiser((headers) =>
      request(buildApiPath(API_ROUTES.organiserOrder, { orderId }), organiserOrderDtoSchema, { headers }),
    ),
  requestRefund: (orderId: string, reason: RefundReason, idempotencyKey: string) =>
    asOrganiser((headers) =>
      post(
        buildApiPath(API_ROUTES.organiserRefunds, { orderId }),
        refundResultDtoSchema,
        { reason },
        {
          ...headers,
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        },
      ),
    ),
  exportOrders: (filters: OrderFilters) =>
    asOrganiser((headers) =>
      requestFile(withQuery(buildApiPath(API_ROUTES.organiserOrdersExport, {}), writeOrderSearchParams(filters)), {
        headers,
      }),
    ),
};
