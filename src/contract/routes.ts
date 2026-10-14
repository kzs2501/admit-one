/**
 * The HTTP API's routes — one table for the client and the server, so a path can't
 * drift between them.
 */
export const API_ROUTES = {
  listEvents: "/api/events",
  getEvent: "/api/events/:slug",
  createHold: "/api/holds",
  getHold: "/api/holds/:holdId",
  upsertOrder: "/api/orders",
  getOrder: "/api/orders/:orderId",
  createPayment: "/api/orders/:orderId/payments",
  confirmChallenge: "/api/payments/:paymentId/challenge",
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
