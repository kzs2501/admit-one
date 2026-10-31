/**
 * The buyer's API on a server, for server mode: the same HTTP handlers as the sandbox,
 * answering requests from a Next route handler instead of a service worker, over the
 * Postgres backend. Server-side only.
 *
 * MSW's `getResponse` is the router here: it runs the very handlers the sandbox uses,
 * so both modes parse, refuse and reply identically. It's one function behind `handle`,
 * replaceable by any router that takes a `Request` and gives a `Response`.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getResponse } from "msw";
import { http } from "msw/http";
import { API_ROUTES } from "@/contract/routes";
import { createBuyerHandlers } from "./http/handlers";
import { anyOrigin, createKit, type Kit } from "./http/kit";
import { createRazorpayHandlers } from "./http/razorpay-handlers";
import { createWebhookHandlers } from "./http/webhook-handlers";
import { createPostgresBackend } from "./postgres/backend";
import { createRazorpayClient, type RazorpayClient } from "./razorpay/client";
import { connect, describeError, sqlStateOf, type Database } from "./postgres/db";
import { SERVER_SETTINGS, type ServerDeps } from "./postgres/records";
import { seed } from "./postgres/seed";
import { createWebhookReceiver, sendDueWebhooks } from "./postgres/webhooks";
import { createPostgresRateLimit } from "./postgres/rate-limit";
import { createRazorpayWebhookReceiver, sendDueCommands, sweepClosedCheckouts } from "./postgres/razorpay";
import { serverConfigFrom } from "./server-config";

/** Where the simulated provider's webhooks are addressed: they're handled in-process. */
const INTERNAL_ORIGIN = "http://dresscircle.internal";

/** The sandbox's alone: the organisers' dashboard and the waiting room. */
const SANDBOX_ONLY = [API_ROUTES.joinQueue, API_ROUTES.getQueueEntry, API_ROUTES.session, "/api/organiser/*"];

function sandboxOnlyHandlers({ problemReply, send }: Kit) {
  return SANDBOX_ONLY.map((route) =>
    http.all(anyOrigin(route), ({ request }) =>
      send(
        request,
        problemReply(
          {
            code: "not_in_server_mode",
            detail: "The organisers’ dashboard and the waiting room run in the sandbox demo only.",
          },
          request,
        ),
      ),
    ),
  );
}

/** A route pattern (`/api/orders/:orderId/payments`) as a test of a path. */
const routeTest = (route: string) => {
  const pattern = new RegExp(`^${route.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
  return (request: Request) => pattern.test(new URL(request.url).pathname);
};

/** Reads of an order's state: before answering one, deliver any webhook that's due. */
const isOrderRead = (request: Request) =>
  request.method === "GET" && (routeTest(API_ROUTES.getOrder)(request) || routeTest(API_ROUTES.getHold)(request));

/** Requests after which the provider's webhook is soon due: a payment, or 3-D Secure approved. */
const startsPayment = (request: Request) =>
  request.method === "POST" &&
  (routeTest(API_ROUTES.createPayment)(request) || routeTest(API_ROUTES.confirmChallenge)(request));

/** Requests that settle a Razorpay payment: what they decide to ask Razorpay for goes at once. */
const settlesRazorpayPayment = (request: Request) =>
  request.method === "POST" &&
  (routeTest(API_ROUTES.razorpayWebhook)(request) || routeTest(API_ROUTES.confirmRazorpayPayment)(request));

/** Retry-After, in seconds, for a request the database couldn't take just now. */
const RETRY_AFTER_SECONDS = 2;

/**
 * Failures worth trying again: a deadlock or serialisation conflict that outlasted its
 * retries, a lost or refused connection, a database out of connections or shutting down.
 */
function isTransient(error: unknown) {
  const code = sqlStateOf(error) ?? "";
  return (
    ["40P01", "40001", "53300"].includes(code) ||
    code.startsWith("08") ||
    code.startsWith("57P") ||
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECTION_CLOSED", "CONNECT_TIMEOUT"].includes(code)
  );
}

/** An error nobody planned for, as a problem: a 503 to retry if it was the database, a 500 if not. */
function unexpectedReply(error: unknown, request: Request, kit: Kit) {
  console.error(`[server] ${request.method} ${new URL(request.url).pathname} failed: ${describeError(error)}`);
  if (!isTransient(error)) {
    return kit.problemReply(
      { code: "internal_error", detail: "The server ran into a problem it didn’t expect." },
      request,
    );
  }
  const problem = kit.problemReply(
    { code: "service_unavailable", detail: "The database couldn’t take this request just now. Try again." },
    request,
  );
  return { ...problem, headers: { "Retry-After": String(RETRY_AFTER_SECONDS) } };
}

const logDeliveryError = (error: unknown) => {
  console.error(`[webhooks] Couldn't deliver the webhooks that are due: ${describeError(error)}`);
};

/**
 * Where a scheduler asks for due webhooks to be sent, so a payment's webhook goes out
 * even when nobody reads the order (a closed tab). Reads and the follow-up after a
 * payment are the quick paths; this is the backstop.
 */
export const DELIVERY_ENDPOINT = "/api/internal/deliver";

/**
 * The rate limit's key for a request: the client's IP from the header a trusted proxy
 * sets (the first address, the client's own, if a list), or null if there's no such
 * header, and so no telling clients apart.
 */
export function clientKeyOf(request: Request, header: string | null): string | null {
  if (header === null) return null;
  const address = request.headers.get(header)?.split(",")[0]?.trim();
  return address ? `ip:${address}` : null;
}

/** The bearer token matches the secret: compared as digests, so in constant time whatever the lengths. */
function isAuthorised(request: Request, secret: string) {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(request.headers.get("Authorization") ?? ""), digest(`Bearer ${secret}`));
}

export function createServerApi(
  db: Database,
  baseDeps: ServerDeps,
  {
    webhookSecret,
    deliverySecret = null,
    fingerprintSecret = null,
    clientIpHeader = null,
    razorpay = null,
  }: {
    webhookSecret: string;
    deliverySecret?: string | null;
    fingerprintSecret?: string | null;
    clientIpHeader?: string | null;
    /** Take payment through Razorpay's checkout, instead of the simulated provider's cards. */
    razorpay?: { client: RazorpayClient; webhookSecret: string } | null;
  },
) {
  // Every context the rules run in knows the provider: what it takes, and Checkout's key.
  const deps: ServerDeps = razorpay
    ? { ...baseDeps, paymentMethods: ["razorpay"], razorpayKeyId: razorpay.client.keyId }
    : baseDeps;
  const backend = createPostgresBackend(db, deps, { razorpay: razorpay?.client ?? null });
  const options = {
    sleep: () => Promise.resolve(),
    random: deps.random,
    now: deps.now,
    fingerprintSecret,
    holdAttempts: createPostgresRateLimit(db, deps.now),
    clientKeyOf: (request: Request) => clientKeyOf(request, clientIpHeader),
  };
  const kit = createKit(backend, options);
  const receiver = razorpay ? createRazorpayWebhookReceiver(db, deps, razorpay.webhookSecret) : null;
  const handlers = [
    ...createBuyerHandlers(backend, options, kit),
    ...createWebhookHandlers(createWebhookReceiver(db, deps, webhookSecret), kit),
    ...(razorpay && receiver
      ? createRazorpayHandlers(
          {
            receiveWebhook: (...args) => receiver.receive(...args),
            confirmCheckout: backend.confirmCheckout,
          },
          kit,
        )
      : []),
    ...sandboxOnlyHandlers(kit),
  ];

  async function respond(request: Request): Promise<Response> {
    try {
      const response = await getResponse(handlers, request);
      return (
        response ?? kit.send(request, kit.problemReply({ code: "not_found", detail: "No such endpoint." }, request))
      );
    } catch (error) {
      return kit.send(request, unexpectedReply(error, request, kit));
    }
  }

  /** The simulated provider sends what's due; returns how many it sent. */
  const deliverDueWebhooks = () =>
    sendDueWebhooks(db, deps, { secret: webhookSecret, send: respond, origin: INTERNAL_ORIGIN });

  /** Everything owed to someone: the simulated provider's webhooks, and what Razorpay is to be asked for. */
  const deliverDue = async () =>
    (await deliverDueWebhooks()) + (razorpay ? await sendDueCommands(db, deps, razorpay.client) : 0);

  /** The scheduler's endpoint: off without a secret, and only for whoever holds it. */
  async function deliverOnSchedule(request: Request): Promise<Response> {
    if (deliverySecret === null || request.method !== "GET") {
      return kit.send(request, kit.problemReply({ code: "not_found", detail: "No such endpoint." }, request));
    }
    if (!isAuthorised(request, deliverySecret)) {
      const problem = kit.problemReply(
        { code: "unauthenticated", detail: "This endpoint is for the scheduler." },
        request,
      );
      // RFC 9110: a 401 says how to authenticate.
      return kit.send(request, { ...problem, headers: { "WWW-Authenticate": 'Bearer realm="Dress Circle"' } });
    }
    // Checkouts first: whatever the sweep settles is then sent with everything else due.
    const swept = razorpay ? await sweepClosedCheckouts(db, deps, razorpay.client) : 0;
    return kit.send(request, { status: 200, body: { delivered: await deliverDue(), swept } });
  }

  return {
    async handle(request: Request): Promise<Response> {
      if (new URL(request.url).pathname === DELIVERY_ENDPOINT) return deliverOnSchedule(request);
      // Webhooks go out when due, and at the latest when the buyer next looks: there's
      // no timer on a serverless function, so correctness never waits for one. A
      // delivery that fails is tried again later; it never fails the buyer's read.
      if (isOrderRead(request)) await deliverDue().catch(logDeliveryError);
      return respond(request);
    },
    /**
     * What to do once a response has gone (Next's `after`): after a payment starts, wait
     * until its webhook is due and send it, so the order page usually finds the order
     * already fulfilled. Null when there's nothing to do.
     */
    followUp(request: Request, response: Response): (() => Promise<void>) | null {
      if (!response.ok) return null;
      if (settlesRazorpayPayment(request)) return () => deliverDue().then(() => undefined, logDeliveryError);
      if (!startsPayment(request)) return null;
      return async () => {
        await new Promise((resolve) => setTimeout(resolve, SERVER_SETTINGS.webhookDelayMs + 100));
        await deliverDue().catch(logDeliveryError);
      };
    },
    deliverDueWebhooks,
    deliverDue,
  };
}

export type ServerApi = ReturnType<typeof createServerApi>;

let serverApi: Promise<ServerApi> | null = null;

/**
 * The process's server API: configured, connected and seeded on first use, then
 * reused. A start that fails isn't kept, so the next request tries again.
 */
export function getServerApi(): Promise<ServerApi> {
  serverApi ??= (async () => {
    const config = serverConfigFrom(process.env);
    if (config.clientIpHeader === null && process.env.NODE_ENV === "production") {
      console.warn(
        "[server] No trusted header names the client's IP, so reserving isn't rate-limited. Set TRUSTED_CLIENT_IP_HEADER to the header your proxy sets.",
      );
    }
    const { db } = connect(config.databaseUrl, { max: 5 });
    await seed(db);
    return createServerApi(
      db,
      {
        now: Date.now,
        newId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        random: Math.random,
        signTicket: config.signTicket,
      },
      {
        webhookSecret: config.webhookSecret,
        deliverySecret: config.deliverySecret,
        fingerprintSecret: config.fingerprintSecret,
        clientIpHeader: config.clientIpHeader,
        razorpay: config.razorpay
          ? { client: createRazorpayClient(config.razorpay), webhookSecret: config.razorpay.webhookSecret }
          : null,
      },
    );
  })().catch((error: unknown) => {
    serverApi = null;
    throw error;
  });
  return serverApi;
}
