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
  "invalid_card",
  "invalid_state",
]);

export const problemSchema = z.discriminatedUnion("code", [
  problemBaseSchema.extend({
    code: z.literal("sold_out"),
    tierId: z.string(),
    available: z.number().int().nonnegative(),
  }),
  problemBaseSchema.extend({ code: z.literal("seats_unavailable"), seatIds: z.array(z.string()).min(1) }),
  problemBaseSchema.extend({ code: z.literal("single_seat_gap"), seatIds: z.array(z.string()).min(1) }),
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
