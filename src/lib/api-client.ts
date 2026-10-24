/**
 * The app's API client. Plain fetch against `/api/*` — written exactly as it would be
 * against a real backend, and the anti-corruption layer between the network and the
 * UI: every response is parsed against the contract's schemas, and every error
 * becomes one of two typed errors.
 *
 * It knows nothing about the simulation; whoever starts the app can hold requests
 * until a dependency is ready (`setApiReadiness`).
 */
import * as z from "@/core/zod";
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
/** A request with no answer by then is given up on, as a network failure. */
let timeoutMs = 15_000;
let recovery: (() => Promise<unknown>) | null = null;
let recovering: Promise<unknown> | null = null;

/** For tests: how long a request may take. */
export function setRequestTimeout(ms: number) {
  timeoutMs = ms;
}

/** Wait for the backend to be ready; if it never can be, say so in words a buyer can use. */
async function whenReady() {
  try {
    await readiness;
  } catch (cause) {
    throw new NetworkError(
      "The demo’s backend couldn’t start in this browser. Reload the page; a private window or blocked site data can stop it.",
      { cause },
    );
  }
}

/** The caller's signal, if any, and the request's time limit, together. */
const withTimeout = (signal: AbortSignal | null | undefined) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

const unreachable = (cause: unknown) =>
  new NetworkError(
    cause instanceof DOMException && cause.name === "TimeoutError"
      ? "The server took too long to answer. Check your connection and try again."
      : "Couldn’t reach the server. Check your connection and try again.",
    { cause },
  );

/** Hold every request until `ready` settles. Set once, at startup. */
export function setApiReadiness(ready: Promise<unknown>) {
  readiness = ready;
}

/**
 * How to bring the API back when an answer says it has gone away
 * (`backend_restarting`): the sandbox starts its service worker again. Set once, at
 * startup. Requests that fail together wait for one recovery.
 */
export function setApiRecovery(recover: (() => Promise<unknown>) | null) {
  recovery = recover;
}

function recover() {
  if (!recovery) return null;
  recovering ??= recovery().finally(() => {
    recovering = null;
  });
  return recovering;
}

export async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  try {
    return await requestOnce(path, schema, init);
  } catch (error) {
    // Nothing was done (the answer came from a stub), so sending it again is safe, once.
    const recovered = error instanceof ApiError && error.problem.code === "backend_restarting" ? recover() : null;
    if (!recovered) throw error;
    await recovered;
    return requestOnce(path, schema, init);
  }
}

async function requestOnce<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit,
): Promise<z.output<Schema>> {
  await whenReady();
  let response: Response;
  try {
    // `new Headers(...)` accepts every HeadersInit shape (object, tuples, Headers);
    // spreading would silently drop the last two.
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", `application/json, ${PROBLEM_CONTENT_TYPE}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(path, { ...init, headers, signal: withTimeout(init.signal) });
  } catch (cause) {
    throw unreachable(cause);
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
  await whenReady();
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal: withTimeout(init.signal) });
  } catch (cause) {
    throw unreachable(cause);
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
