/**
 * The HTTP API's routes — one table for the client and the server, so a path can't
 * drift between them.
 */
export const API_ROUTES = {
  listEvents: "/api/events",
  getEvent: "/api/events/:slug",
  getSeatAvailability: "/api/events/:slug/seats",
  joinQueue: "/api/events/:slug/queue",
  getQueueEntry: "/api/queue/:token",
  createHold: "/api/holds",
  getHold: "/api/holds/:holdId",
  upsertOrder: "/api/orders",
  getOrder: "/api/orders/:orderId",
  createPayment: "/api/orders/:orderId/payments",
  confirmChallenge: "/api/payments/:paymentId/challenge",
  cancelPayment: "/api/payments/:paymentId/cancel",
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

/** `"/api/orders/:orderId/payments"` → `"orderId"` */
type RouteParamName<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? Param | RouteParamName<`/${Rest}`>
  : Path extends `${string}:${infer Param}`
    ? Param
    : never;

export type RouteParams<Path extends string> = Record<RouteParamName<Path>, string>;

/** Fill in a route's `:params`, URL-encoding each value. */
export function buildApiPath<Path extends ApiRoute>(route: Path, params: RouteParams<Path>): string {
  const values: Record<string, string> = params;
  return route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(values[name] ?? ""));
}

/** Payments must carry one; see the `missing_idempotency_key` problem. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** A place in a sale's waiting room; reserving needs one whose turn has come. See `queue_required`. */
export const QUEUE_TOKEN_HEADER = "Queue-Token";

/** How long to wait before trying again, in seconds (RFC 9110 §10.2.3); sent with a 429. */
export const RETRY_AFTER_HEADER = "Retry-After";
