/**
 * The HTTP layer of the simulated backend: routing, status codes, headers and
 * latency. Everything domain-related is delegated to the server; these handlers are
 * as thin as a real API's controllers should be.
 */
import { http, HttpResponse } from "msw/http";
import type { Result, Server } from "@/backend/server";

type Options = {
  /** Wait helper — real timers in the browser, instant in tests. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export function createHandlers(server: Server, { sleep, random }: Options) {
  const latency = (extra = 0) => {
    const [min, max] = server.chaos().latencyMs;
    return sleep(min + random() * (max - min) + extra);
  };

  const respond = <T>(method: string, path: string, result: Result<T>) => {
    const status = result.ok ? result.status : result.error.status;
    server.log("request", `${method} ${path} → ${status}`);
    return result.ok
      ? HttpResponse.json(result.value as object, { status })
      : HttpResponse.json(
          { error: { code: result.error.code, message: result.error.message, details: result.error.details } },
          { status },
        );
  };

  const json = async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  };

  // `*/api/...` matches any origin, so the same handlers work in the browser and in
  // Node-based tests.
  return [
    http.get("*/api/events", async () => {
      await latency();
      return respond("GET", "/api/events", server.listEvents());
    }),

    http.get("*/api/events/:slug", async ({ params }) => {
      await latency();
      return respond("GET", `/api/events/${params.slug}`, server.getEvent(String(params.slug)));
    }),

    http.post("*/api/holds", async ({ request }) => {
      const body = await json(request);
      await latency();
      return respond("POST", "/api/holds", server.createHold(body));
    }),

    http.get("*/api/holds/:id", async ({ params }) => {
      await latency();
      return respond("GET", `/api/holds/${params.id}`, server.getHold(String(params.id)));
    }),

    http.post("*/api/orders", async ({ request }) => {
      const body = await json(request);
      await latency();
      return respond("POST", "/api/orders", server.upsertOrder(body));
    }),

    http.get("*/api/orders/:id", async ({ params }) => {
      await latency();
      return respond("GET", `/api/orders/${params.id}`, server.getOrder(String(params.id)));
    }),

    http.post("*/api/orders/:id/payments", async ({ params, request }) => {
      const body = await json(request);
      // The work happens *before* the response is delayed: that's what lets a
      // webhook beat the browser in the "webhook before redirect" preset.
      const result = server.createPayment(String(params.id), body, request.headers.get("Idempotency-Key"));
      await latency(server.chaos().paymentLatencyMs);
      return respond("POST", `/api/orders/${params.id}/payments`, result);
    }),

    http.post("*/api/payments/:id/challenge", async ({ params, request }) => {
      const body = (await json(request)) as { approve?: unknown } | undefined;
      await latency();
      return respond(
        "POST",
        `/api/payments/${params.id}/challenge`,
        server.confirmChallenge(String(params.id), body?.approve === true),
      );
    }),
  ];
}
