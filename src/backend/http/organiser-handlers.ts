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
import type { Account } from "@/core/organisations";
import { createSessionRequestSchema } from "@/contract/requests";
import { API_ROUTES, AUTHORIZATION_HEADER } from "@/contract/routes";
import { anyOrigin, type Kit, type Reply } from "./kit";
import { toAccountDto, toOrganiserEventDto, toSessionDto } from "./mappers";

const CHALLENGE = 'Bearer realm="admit-one"';
const PRIVATE = { "Cache-Control": "no-store" };

/** `Authorization: Bearer <token>`; the scheme is case-insensitive (RFC 9110 §11.1). */
export const bearerTokenOf = (request: Request) =>
  /^Bearer +([\w.~+/-]+=*)$/i.exec(request.headers.get(AUTHORIZATION_HEADER) ?? "")?.[1] ?? null;

export function createOrganiserHandlers(
  backend: Backend,
  { latency, problemReply, resultReply, send, sendEmpty, parseBody }: Kit,
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
