/**
 * The app's API client. Plain fetch against `/api/*` — written exactly as it would be
 * against a real backend, and the anti-corruption layer between the network and the
 * UI: every response is parsed against the contract's schemas, and every error
 * becomes one of two typed errors.
 *
 * It knows nothing about the simulation; whoever starts the app can hold requests
 * until a dependency is ready (`setApiReadiness`).
 */
import { z } from "zod";
import { eventDtoSchema, holdDetailsDtoSchema, orderDtoSchema, paymentResultDtoSchema } from "@/contract/dto";
import { PROBLEM_CONTENT_TYPE, problemSchema, type Problem } from "@/contract/problems";
import type { ConfirmChallengeRequest, CreateHoldRequest, UpsertOrderRequest } from "@/contract/requests";
import { API_ROUTES, buildApiPath, IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import type { CardInput } from "@/core/schemas";

/** The server answered with an RFC 9457 problem. Branch on `problem.code`. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(readonly problem: Problem) {
    super(problem.detail);
  }
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

async function request<Schema extends z.ZodType>(
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
    if (problem.success) throw new ApiError(problem.data);
    throw new NetworkError(`The server answered ${response.status} without a problem description.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new NetworkError("The server’s response didn’t match the API contract.", { cause: parsed.error });
  }
  return parsed.data;
}

const post = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  body: unknown,
  headers: Record<string, string> = {},
) => request(path, schema, { method: "POST", body: JSON.stringify(body), headers });

export const apiClient = {
  listEvents: () => request(buildApiPath(API_ROUTES.listEvents, {}), z.array(eventDtoSchema)),
  getEvent: (slug: string) => request(buildApiPath(API_ROUTES.getEvent, { slug }), eventDtoSchema),
  createHold: (body: CreateHoldRequest) => post(buildApiPath(API_ROUTES.createHold, {}), holdDetailsDtoSchema, body),
  getHold: (holdId: string) => request(buildApiPath(API_ROUTES.getHold, { holdId }), holdDetailsDtoSchema),
  upsertOrder: (body: UpsertOrderRequest) => post(buildApiPath(API_ROUTES.upsertOrder, {}), orderDtoSchema, body),
  getOrder: (orderId: string) => request(buildApiPath(API_ROUTES.getOrder, { orderId }), orderDtoSchema),
  createPayment: (orderId: string, card: CardInput, idempotencyKey: string) =>
    post(buildApiPath(API_ROUTES.createPayment, { orderId }), paymentResultDtoSchema, card, {
      [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    }),
  confirmChallenge: (paymentId: string, body: ConfirmChallengeRequest) =>
    post(buildApiPath(API_ROUTES.confirmChallenge, { paymentId }), paymentResultDtoSchema, body),
};

/** The problem behind an error, if the server sent one. */
export const problemOf = (error: unknown): Problem | null => (error instanceof ApiError ? error.problem : null);

/**
 * Whether an error is a glitch rather than an answer. A 4xx problem is the server's
 * considered reply — asking again gets the same one — while a lost connection or a 5xx
 * may well go away.
 */
export const isTransientError = (error: unknown) => !(error instanceof ApiError && error.problem.status < 500);
