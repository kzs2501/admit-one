/**
 * The app's API client. Plain fetch against `/api/*` — written exactly as it would be
 * against a real backend, and the anti-corruption layer between the network and the
 * UI: every response is parsed against the contract's schemas, and every error
 * becomes one of two typed errors.
 *
 * It knows nothing about the simulation; whoever starts the app can hold requests
 * until a dependency is ready (`setApiReadiness`).
 */
import { z } from "@/core/zod";
import {
  eventDtoSchema,
  holdDetailsDtoSchema,
  orderDtoSchema,
  paymentResultDtoSchema,
  queueEntryDtoSchema,
  seatAvailabilityDtoSchema,
} from "@/contract/dto";
import { PROBLEM_CONTENT_TYPE, problemSchema, type Problem } from "@/contract/problems";
import type {
  ConfirmChallengeRequest,
  CreateHoldRequest,
  CreatePaymentRequest,
  UpsertOrderRequest,
} from "@/contract/requests";
import {
  API_ROUTES,
  buildApiPath,
  IDEMPOTENCY_KEY_HEADER,
  QUEUE_TOKEN_HEADER,
  RETRY_AFTER_HEADER,
} from "@/contract/routes";

/** The server answered with an RFC 9457 problem. Branch on `problem.code`. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly problem: Problem,
    /** How long the server asked us to wait before trying again (`Retry-After`), if it did. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(problem.detail);
  }
}

/** "Sun, 06 Nov 1994 08:49:37 GMT" — the HTTP-date format servers send (RFC 9110 §5.6.7). */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * `Retry-After` (RFC 9110 §10.2.3) is either a number of seconds or an HTTP-date.
 * Anything else is ignored rather than guessed at — `Date.parse` alone would read
 * "-5" as the year 5 BC.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (!IMF_FIXDATE.test(trimmed)) return null;
  return Math.max(0, Date.parse(trimmed) - nowMs);
}

/** No usable answer: the request never completed, or the response broke the contract. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

let readiness: Promise<unknown> = Promise.resolve();

/** Hold every request until `ready` settles. Set once, at startup. */
export function setApiReadiness(ready: Promise<unknown>) {
  readiness = ready;
}

export async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  await readiness;
  let response: Response;
  try {
    // `new Headers(...)` accepts every HeadersInit shape (object, tuples, Headers);
    // spreading would silently drop the last two.
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", `application/json, ${PROBLEM_CONTENT_TYPE}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(path, { ...init, headers });
  } catch (cause) {
    throw new NetworkError("Couldn’t reach the server. Check your connection and try again.", { cause });
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = problemSchema.safeParse(body);
    if (problem.success) {
      throw new ApiError(problem.data, parseRetryAfter(response.headers.get(RETRY_AFTER_HEADER), Date.now()));
    }
    throw new NetworkError(`The server answered ${response.status} without a problem description.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new NetworkError("The server’s response didn’t match the API contract.", { cause: parsed.error });
  }
  return parsed.data;
}

/** A file from the API, such as a CSV export: its contents and the name the server gave it, or the problem. */
export async function requestFile(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
  await readiness;
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    throw new NetworkError("Couldn’t reach the server. Check your connection and try again.", { cause });
  }
  if (response.ok) {
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
    return { blob: await response.blob(), filename };
  }
  const problem = problemSchema.safeParse(await response.json().catch(() => undefined));
  if (problem.success) throw new ApiError(problem.data, null);
  throw new NetworkError(`The server answered ${response.status} without a problem description.`);
}

export const post = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  body: unknown,
  headers: Record<string, string> = {},
) => request(path, schema, { method: "POST", body: JSON.stringify(body), headers });

export const apiClient = {
  listEvents: () => request(buildApiPath(API_ROUTES.listEvents, {}), z.array(eventDtoSchema)),
  getEvent: (slug: string) => request(buildApiPath(API_ROUTES.getEvent, { slug }), eventDtoSchema),
  getSeatAvailability: (slug: string) =>
    request(buildApiPath(API_ROUTES.getSeatAvailability, { slug }), seatAvailabilityDtoSchema),
  /** In a sale with a waiting room, `queueToken` is your place in its queue. */
  createHold: (body: CreateHoldRequest, queueToken: string | null = null) =>
    post(
      buildApiPath(API_ROUTES.createHold, {}),
      holdDetailsDtoSchema,
      body,
      queueToken ? { [QUEUE_TOKEN_HEADER]: queueToken } : {},
    ),
  joinQueue: (slug: string) =>
    request(buildApiPath(API_ROUTES.joinQueue, { slug }), queueEntryDtoSchema, { method: "POST" }),
  getQueueEntry: (token: string) => request(buildApiPath(API_ROUTES.getQueueEntry, { token }), queueEntryDtoSchema),
  getHold: (holdId: string) => request(buildApiPath(API_ROUTES.getHold, { holdId }), holdDetailsDtoSchema),
  upsertOrder: (body: UpsertOrderRequest) => post(buildApiPath(API_ROUTES.upsertOrder, {}), orderDtoSchema, body),
  getOrder: (orderId: string) => request(buildApiPath(API_ROUTES.getOrder, { orderId }), orderDtoSchema),
  createPayment: (orderId: string, body: CreatePaymentRequest, idempotencyKey: string) =>
    post(buildApiPath(API_ROUTES.createPayment, { orderId }), paymentResultDtoSchema, body, {
      [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    }),
  confirmChallenge: (paymentId: string, body: ConfirmChallengeRequest) =>
    post(buildApiPath(API_ROUTES.confirmChallenge, { paymentId }), paymentResultDtoSchema, body),
  cancelPayment: (paymentId: string) =>
    post(buildApiPath(API_ROUTES.cancelPayment, { paymentId }), paymentResultDtoSchema, {}),
};

/** The problem behind an error, if the server sent one. */
export const problemOf = (error: unknown): Problem | null => (error instanceof ApiError ? error.problem : null);

/**
 * Whether an error is a glitch rather than an answer. A 4xx problem is the server's
 * considered reply — asking again gets the same one — while a lost connection or a 5xx
 * may well go away. A 429 is "not now", not "no": it passes, after `Retry-After`.
 */
export const isTransientError = (error: unknown) =>
  !(error instanceof ApiError && error.problem.status < 500 && error.problem.status !== 429);
