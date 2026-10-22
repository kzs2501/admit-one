/**
 * Errors on the wire: RFC 9457 problem details (`application/problem+json`).
 *
 * Every problem carries the standard members — `type`, `title`, `status`, `detail`,
 * `instance` — plus a machine-readable `code`, and some carry typed extension members
 * (RFC 9457 §3.2), such as how many tickets are left when a tier sells out. Clients
 * branch on `code`; `detail` is written for people.
 */
import { z } from "@/core/zod";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

const problemBaseSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.url().optional(),
});

/** Problems with no extension members. */
const plainProblemCodeSchema = z.enum([
  "not_found",
  "invalid_request",
  "hold_expired",
  "already_completed",
  "payment_in_progress",
  "missing_idempotency_key",
  "idempotency_key_reused",
  "idempotency_key_in_use",
  "invalid_card",
  "invalid_state",
  "unauthenticated",
  "forbidden",
  "refund_failed",
  "invalid_signature",
  "not_in_server_mode",
  "service_unavailable",
  "internal_error",
  "payload_too_large",
  "payment_method_unavailable",
]);

export const problemSchema = z.discriminatedUnion("code", [
  problemBaseSchema.extend({
    code: z.literal("sold_out"),
    tierId: z.string(),
    available: z.number().int().nonnegative(),
  }),
  problemBaseSchema.extend({ code: z.literal("seats_unavailable"), seatIds: z.array(z.string()).min(1) }),
  problemBaseSchema.extend({ code: z.literal("single_seat_gap"), seatIds: z.array(z.string()).min(1) }),
  problemBaseSchema.extend({ code: z.literal("rate_limited"), retryAfterSeconds: z.number().int().positive() }),
  problemBaseSchema.extend({ code: z.literal("queue_required"), eventSlug: z.string() }),
  problemBaseSchema.extend({ code: z.literal("card_declined"), paymentId: z.string() }),
  problemBaseSchema.extend({ code: z.literal("authentication_failed"), paymentId: z.string() }),
  problemBaseSchema.extend({ code: plainProblemCodeSchema }),
]);

export type Problem = z.infer<typeof problemSchema>;

/** A problem as the server sends it: `instance` (the request's URL) is always set. */
export type ProblemDocument = Problem & { instance: string };
export type ProblemCode = Problem["code"];

export const PROBLEM_CODES: readonly ProblemCode[] = [
  "sold_out",
  "seats_unavailable",
  "single_seat_gap",
  "rate_limited",
  "queue_required",
  "card_declined",
  "authentication_failed",
  ...plainProblemCodeSchema.options,
];

interface ProblemDefinition {
  status: number;
  title: string;
  description: string;
}

/** The status and title of every problem — one table, so the server and the docs can't disagree. */
export const PROBLEM_CATALOG: Record<ProblemCode, ProblemDefinition> = {
  not_found: {
    status: 404,
    title: "Not found",
    description: "The event, reservation, order or payment doesn’t exist — or it belongs to another sandbox.",
  },
  invalid_request: {
    status: 422,
    title: "Invalid request",
    description: "The request body is missing something or breaks a rule, such as reserving zero tickets.",
  },
  sold_out: {
    status: 409,
    title: "Not enough tickets left",
    description: "Fewer tickets are available than were asked for. `available` says how many are left.",
  },
  seats_unavailable: {
    status: 409,
    title: "Seats no longer available",
    description:
      "Some of the chosen seats were sold or held by someone else first. `seatIds` lists them; nothing was held, so choose again.",
  },
  single_seat_gap: {
    status: 422,
    title: "A single seat would be left empty",
    description:
      "The seats chosen would leave one empty seat that nobody could book as part of a pair. `seatIds` lists it; move the selection over by one.",
  },
  rate_limited: {
    status: 429,
    title: "Too many attempts",
    description:
      "This client has made too many reservation attempts in a short time. The `Retry-After` header (and `retryAfterSeconds`) says how long to wait; waiting that long always works.",
  },
  queue_required: {
    status: 403,
    title: "It isn’t your turn yet",
    description:
      "This sale has a waiting room. Reserving needs a `Queue-Token` for a place in this sale’s queue whose turn has come — and not yet gone. `eventSlug` says which queue to join.",
  },
  hold_expired: {
    status: 410,
    title: "Reservation expired",
    description: "The reservation ran out before payment started. Reserve the tickets again.",
  },
  already_completed: {
    status: 409,
    title: "Order already completed",
    description: "The order has been paid or settled, so it can no longer be changed or paid again.",
  },
  payment_in_progress: {
    status: 409,
    title: "Payment already in progress",
    description: "A payment for this order is waiting for the bank or the provider’s webhook.",
  },
  missing_idempotency_key: {
    status: 400,
    title: "Idempotency-Key required",
    description: "Payment requests must carry an `Idempotency-Key` header, so a retry can never charge twice.",
  },
  idempotency_key_reused: {
    status: 422,
    title: "Idempotency-Key reused",
    description: "The key was already used for a different request. Use a new key for a new payment attempt.",
  },
  idempotency_key_in_use: {
    status: 409,
    title: "Request still in progress",
    description:
      "A request with this Idempotency-Key is still being handled. Wait a moment and send the same request again: you’ll get its answer, and nothing happens twice.",
  },
  invalid_card: {
    status: 422,
    title: "Invalid card details",
    description: "The card details failed validation — for example, the number doesn’t pass its checksum.",
  },
  card_declined: {
    status: 402,
    title: "Card declined",
    description: "The bank declined the charge. `paymentId` identifies the failed payment; try another card.",
  },
  authentication_failed: {
    status: 402,
    title: "Authentication failed",
    description: "The buyer didn’t complete the bank’s 3-D Secure check. `paymentId` identifies the payment.",
  },
  invalid_state: {
    status: 409,
    title: "Not allowed right now",
    description: "The resource isn’t in a state that allows this action, such as answering a finished challenge.",
  },
  unauthenticated: {
    status: 401,
    title: "Sign in first",
    description:
      "The organisers’ API needs `Authorization: Bearer <token>` from signing in. The `WWW-Authenticate` header says whether a token was missing or is no longer valid (RFC 6750).",
  },
  not_in_server_mode: {
    status: 501,
    title: "Only in the sandbox",
    description:
      "The organisers’ dashboard and the waiting room run in the browser sandbox, the public demo. The server, on Postgres, serves the buyer’s checkout.",
  },
  invalid_signature: {
    status: 400,
    title: "Webhook signature invalid",
    description:
      "A webhook must carry the provider’s signature over its exact body, made in the last five minutes. One without it, or with a body changed since it was signed, is refused and nothing happens.",
  },
  refund_failed: {
    status: 502,
    title: "The refund couldn’t start",
    description:
      "The payment provider refused to start the refund, so nothing was refunded and the order is unchanged. It’s safe to try again later.",
  },
  payload_too_large: {
    status: 413,
    title: "Request too large",
    description:
      "The request body is over 64 KB, more than any request to this API needs. Nothing was read or changed.",
  },
  payment_method_unavailable: {
    status: 422,
    title: "Payment method not available",
    description:
      "This server doesn’t take that payment method. Paying by UPI needs a real payment provider, so server mode takes cards; the sandbox demo simulates UPI.",
  },
  service_unavailable: {
    status: 503,
    title: "Busy for a moment",
    description:
      "The server couldn’t finish the request just now: its database was busy or out of reach. Nothing was changed, so it’s safe to send the same request again after the `Retry-After` header’s seconds.",
  },
  internal_error: {
    status: 500,
    title: "Something went wrong on our side",
    description:
      "The server ran into a problem it didn’t expect, and has logged it. Nothing was changed. If it keeps happening, it’s a bug to report.",
  },
  forbidden: {
    status: 403,
    title: "Not allowed for this account",
    description:
      "The account is signed in but may not do this: the event belongs to another organiser, or the account’s role doesn’t include the permission. Private things that belong to another organiser, such as orders, are `not_found` instead, so their existence isn’t confirmed.",
  },
};

/** `sold_out` → `sold-out` */
export const problemSlugFor = (code: ProblemCode) => code.replaceAll("_", "-");

/** `sold_out` → `/problems/sold-out`, the problem type's documentation page. */
export const problemPathFor = (code: ProblemCode) => `/problems/${problemSlugFor(code)}`;

/**
 * `sold_out` → `https://<origin>/problems/sold-out`. RFC 9457 recommends absolute type
 * URIs; this one is on the API's own origin, so it always resolves to its documentation.
 */
export const problemTypeFor = (code: ProblemCode, origin: string) => new URL(problemPathFor(code), origin).href;

/** `sold-out` → `sold_out`, for the documentation pages. */
export const findProblemCodeBySlug = (slug: string): ProblemCode | undefined =>
  PROBLEM_CODES.find((code) => problemSlugFor(code) === slug);
