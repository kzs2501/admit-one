/**
 * The organisers' API. Every request except signing in needs a bearer token
 * (RFC 6750), and every answer is private to one account, so none may be stored by a
 * cache. Statuses say exactly what went wrong:
 *
 * - **401** — who are you? No token, or one that's no longer valid. `WWW-Authenticate`
 *   says which.
 * - **403** — not for you: something public, like an event, that this account may not
 *   act on.
 * - **404** — private things that belong to someone else, like their orders, aren't
 *   confirmed to exist.
 */
import { http } from "msw/http";
import type { Backend } from "@/backend/backend";
import { toDecimalString } from "@/core/money";
import { getOrganisation, type Account } from "@/core/organisations";
import { zonedDate, zonedDateTime } from "@/core/time";
import type { OrderRowView } from "@/backend/domain/views";
import { orderFiltersSchema, orderListParamsSchema, readOrderSearchParams } from "@/contract/queries";
import { createSessionRequestSchema } from "@/contract/requests";
import { API_ROUTES, AUTHORIZATION_HEADER } from "@/contract/routes";
import { anyOrigin, type Kit, type Reply } from "./kit";
import { toCsv, type CsvCell } from "./csv";
import {
  toAccountDto,
  toOrderPageDto,
  toOrganiserEventDto,
  toOrganiserOrderDto,
  toSalesMetricsDto,
  toSessionDto,
} from "./mappers";

const CHALLENGE = 'Bearer realm="admit-one"';
const PRIVATE = { "Cache-Control": "no-store" };

/** `Authorization: Bearer <token>`; the scheme is case-insensitive (RFC 9110 §11.1). */
export const bearerTokenOf = (request: Request) =>
  /^Bearer +([\w.~+/-]+=*)$/i.exec(request.headers.get(AUTHORIZATION_HEADER) ?? "")?.[1] ?? null;

const CSV_COLUMNS = [
  "order_id",
  "event",
  "created_at_local",
  "buyer_name",
  "buyer_email",
  "tickets",
  "status",
  "payment_method",
  "total",
  "currency",
] as const;

/** One CSV record per order. Dates are in the organisation's time zone; amounts are plain decimals. */
const csvRecord = (row: OrderRowView, timeZone: string): CsvCell[] => [
  row.id,
  { text: row.eventName },
  zonedDateTime(row.createdAtMs, timeZone),
  { text: row.buyerName },
  { text: row.buyerEmail },
  row.ticketCount,
  row.status,
  row.paymentMethod ?? "",
  toDecimalString(row.totalMinor),
  row.currency,
];

export function createOrganiserHandlers(
  backend: Backend,
  { latency, problemReply, resultReply, send, sendText, sendEmpty, parseBody }: Kit,
) {
  const sendPrivate = (request: Request, reply: Reply) =>
    send(request, { ...reply, headers: { ...reply.headers, ...PRIVATE } });

  /** The signed-in account, or the 401 that says why there isn't one. */
  function signedIn(request: Request): { ok: true; account: Account } | { ok: false; reply: Reply } {
    const token = bearerTokenOf(request);
    const account = backend.authenticate(token);
    if (account) return { ok: true, account };
    const problem = problemReply(
      { code: "unauthenticated", detail: token ? "Your session has ended. Sign in again." : "Sign in to see this." },
      request,
    );
    // RFC 6750 §3.1: a token that was sent but isn't valid is `invalid_token`; a missing one has no error code.
    const challenge = token ? `${CHALLENGE}, error="invalid_token"` : CHALLENGE;
    return { ok: false, reply: { ...problem, headers: { "WWW-Authenticate": challenge } } };
  }

  return [
    http.post(anyOrigin(API_ROUTES.session), async ({ request }) => {
      const input = await parseBody(request, createSessionRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      return sendPrivate(request, resultReply(backend.signIn(input.value.accountId), request, toSessionDto, 201));
    }),

    /** Sign out: the token stops working. Idempotent — signing out twice, or without a session, is still a 204. */
    http.delete(anyOrigin(API_ROUTES.session), async ({ request }) => {
      await latency();
      const token = bearerTokenOf(request);
      if (token) backend.signOut(token);
      return sendEmpty(request, 204);
    }),

    http.get(anyOrigin(API_ROUTES.organiserAccount), async ({ request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      return sendPrivate(request, { status: 200, body: toAccountDto(backend.accountView(auth.account)) });
    }),

    http.get(anyOrigin(API_ROUTES.organiserEvents), async ({ request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      return sendPrivate(request, {
        status: 200,
        body: backend.listOrganiserEvents(auth.account).map(toOrganiserEventDto),
      });
    }),

    /** A page of orders, filtered and sorted on the server: `?status=fulfilled&orderBy=totalMinor desc&pageToken=…`. */
    http.get(anyOrigin(API_ROUTES.organiserOrders), async ({ request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      const params = orderListParamsSchema.safeParse(readOrderSearchParams(new URL(request.url).searchParams));
      if (!params.success) {
        const detail = params.error.issues[0]?.message ?? "Check the query.";
        return sendPrivate(request, problemReply({ code: "invalid_request", detail }, request));
      }
      return sendPrivate(request, resultReply(backend.listOrders(auth.account, params.data), request, toOrderPageDto));
    }),

    /** Every matching order as CSV, for a spreadsheet. The same filters as the list; no paging. */
    http.get(anyOrigin(API_ROUTES.organiserOrdersExport), async ({ request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      const filters = orderFiltersSchema.safeParse(readOrderSearchParams(new URL(request.url).searchParams));
      if (!filters.success) {
        const detail = filters.error.issues[0]?.message ?? "Check the query.";
        return sendPrivate(request, problemReply({ code: "invalid_request", detail }, request));
      }
      const result = backend.exportOrders(auth.account, filters.data);
      if (!result.ok) return sendPrivate(request, problemReply(result.error, request));
      const { id: organisationId, timeZone } = getOrganisation(auth.account.organisationId);
      const filename = `${organisationId}-orders-${zonedDate(backend.now(), timeZone)}.csv`;
      return sendText(
        request,
        toCsv(
          CSV_COLUMNS,
          result.value.map((row) => csvRecord(row, timeZone)),
        ),
        {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          ...PRIVATE,
        },
      );
    }),

    /** Sales across the account's events, or for one: `?event=lakeside-lights`. */
    http.get(anyOrigin(API_ROUTES.organiserMetrics), async ({ request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      const { event: eventSlug } = readOrderSearchParams(new URL(request.url).searchParams);
      return sendPrivate(
        request,
        resultReply(backend.salesMetrics(auth.account, eventSlug), request, toSalesMetricsDto),
      );
    }),

    /** One order. Another organiser's is a 404: it isn't confirmed to exist. */
    http.get<{ orderId: string }>(anyOrigin(API_ROUTES.organiserOrder), async ({ params, request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      return sendPrivate(
        request,
        resultReply(backend.getOrganiserOrder(auth.account, params.orderId), request, toOrganiserOrderDto),
      );
    }),

    http.get<{ slug: string }>(anyOrigin(API_ROUTES.organiserEvent), async ({ params, request }) => {
      await latency();
      const auth = signedIn(request);
      if (!auth.ok) return sendPrivate(request, auth.reply);
      return sendPrivate(
        request,
        resultReply(backend.getOrganiserEvent(auth.account, params.slug), request, toOrganiserEventDto),
      );
    }),
  ];
}
