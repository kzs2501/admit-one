/**
 * The HTTP adapter of the simulated backend: routing, request parsing, status codes,
 * problem details, idempotency keys and latency. Everything domain-related is
 * delegated to the backend; these handlers are as thin as a real API's controllers.
 */
import { http, HttpResponse } from "msw/http";
import type { z } from "zod";
import type { Backend } from "@/backend/backend";
import type { DomainError, Result } from "@/backend/domain/errors";
import type { JsonValue } from "@/backend/domain/state";
import type { PaymentResultView } from "@/backend/domain/views";
import { PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import {
  confirmChallengeRequestSchema,
  createHoldRequestSchema,
  createPaymentRequestSchema,
  upsertOrderRequestSchema,
} from "@/contract/requests";
import { API_ROUTES, IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { toEventDto, toHoldDetailsDto, toOrderDto, toPaymentResultDto } from "./mappers";
import { toProblem } from "./problems";

interface HandlerOptions {
  /** Wait helper — real timers in the browser, instant in tests. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

/** A response before it's sent: a status and a JSON body (a DTO or a problem). */
interface Reply {
  status: number;
  body: JsonValue;
}

const PAYMENT_FAILURE_DETAILS = {
  card_declined: "Your card was declined. Try a different card.",
  authentication_failed: "Authentication failed. Try again or use a different card.",
} as const;

// `*/api/...` matches any origin, so the same handlers work in the browser and in
// Node-based tests.
const anyOrigin = (route: string) => `*${route}`;

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function createHandlers(backend: Backend, { sleep, random }: HandlerOptions) {
  const latency = (extraMs = 0) => {
    const [minMs, maxMs] = backend.chaos().latencyRangeMs;
    return sleep(minMs + random() * (maxMs - minMs) + extraMs);
  };

  const pathOf = (request: Request) => new URL(request.url).pathname;

  const problemReply = (error: DomainError, request: Request): Reply => {
    const problem = toProblem(error, pathOf(request));
    return { status: problem.status, body: problem };
  };

  const resultReply = <T>(result: Result<T>, request: Request, toBody: (value: T) => JsonValue, status = 200): Reply =>
    result.ok ? { status, body: toBody(result.value) } : problemReply(result.error, request);

  const send = (request: Request, { status, body }: Reply) => {
    backend.log("request", `${request.method} ${pathOf(request)} → ${status}`);
    return status >= 400
      ? HttpResponse.json(body, { status, headers: { "Content-Type": PROBLEM_CONTENT_TYPE } })
      : HttpResponse.json(body, { status });
  };

  /** Parse a request body against its schema; a body that doesn't parse is the client's problem. */
  async function parseBody<Schema extends z.ZodType>(
    request: Request,
    schema: Schema,
  ): Promise<{ ok: true; value: z.output<Schema> } | { ok: false; reply: Reply }> {
    const parsed = schema.safeParse(await readJson(request));
    if (parsed.success) return { ok: true, value: parsed.data };
    const detail = parsed.error.issues[0]?.message ?? "The request body is invalid.";
    return { ok: false, reply: problemReply({ code: "invalid_request", detail }, request) };
  }

  /** An attempted charge: 202 while it's processing or needs authentication, 402 when the bank said no. */
  function paymentReply(result: Result<PaymentResultView>, request: Request): Reply {
    if (!result.ok) return problemReply(result.error, request);
    const { payment } = result.value;
    if (payment.status === "failed") {
      const code = payment.failureCode ?? "card_declined";
      return problemReply({ code, detail: PAYMENT_FAILURE_DETAILS[code], paymentId: payment.id }, request);
    }
    return { status: 202, body: toPaymentResultDto(result.value) };
  }

  return [
    http.get(anyOrigin(API_ROUTES.listEvents), async ({ request }) => {
      await latency();
      return send(request, { status: 200, body: backend.listEvents().map(toEventDto) });
    }),

    http.get<{ slug: string }>(anyOrigin(API_ROUTES.getEvent), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(backend.getEvent(params.slug), request, toEventDto));
    }),

    http.post(anyOrigin(API_ROUTES.createHold), async ({ request }) => {
      const input = await parseBody(request, createHoldRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      return send(request, resultReply(backend.createHold(input.value), request, toHoldDetailsDto, 201));
    }),

    http.get<{ holdId: string }>(anyOrigin(API_ROUTES.getHold), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(backend.getHold(params.holdId), request, toHoldDetailsDto));
    }),

    http.post(anyOrigin(API_ROUTES.upsertOrder), async ({ request }) => {
      const input = await parseBody(request, upsertOrderRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      const result = backend.upsertOrder(input.value);
      return send(
        request,
        result.ok
          ? { status: result.value.isCreated ? 201 : 200, body: toOrderDto(result.value.order) }
          : problemReply(result.error, request),
      );
    }),

    http.get<{ orderId: string }>(anyOrigin(API_ROUTES.getOrder), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(backend.getOrder(params.orderId), request, toOrderDto));
    }),

    /**
     * Start a payment. The Idempotency-Key makes retries safe: the same key always gets
     * the same response, so a double-click or a retried request can never charge twice
     * (the approach Stripe describes in "Designing robust and predictable APIs with
     * idempotency"). Only attempted charges are stored, so a request rejected before
     * charging — an expired hold, an invalid card — can be retried with the same key.
     */
    http.post<{ orderId: string }>(anyOrigin(API_ROUTES.createPayment), async ({ params, request }) => {
      const reply = await (async (): Promise<Reply> => {
        const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
        if (!key) {
          return problemReply(
            { code: "missing_idempotency_key", detail: "Payments need an Idempotency-Key header." },
            request,
          );
        }
        const card = createPaymentRequestSchema.safeParse(await readJson(request));
        const fingerprint = `${params.orderId}:${card.success ? card.data.number.slice(-4) : "invalid"}`;

        const stored = backend.idempotency.find(key);
        if (stored) {
          if (stored.fingerprint !== fingerprint) {
            return problemReply(
              { code: "idempotency_key_reused", detail: "That Idempotency-Key was used for a different request." },
              request,
            );
          }
          backend.log("payment", "Idempotency-Key replayed — returning the original response, no new charge.");
          return { status: stored.status, body: stored.body };
        }

        if (!card.success) {
          const detail = card.error.issues[0]?.message ?? "Check the card details.";
          return problemReply({ code: "invalid_card", detail }, request);
        }
        const result = backend.createPayment(params.orderId, card.data);
        const attempted = paymentReply(result, request);
        if (result.ok) backend.idempotency.save(key, { fingerprint, ...attempted });
        return attempted;
      })();
      // The work happens *before* the response is delayed: that's what lets a webhook
      // beat the browser in the "webhook before redirect" preset.
      await latency(backend.chaos().extraPaymentLatencyMs);
      return send(request, reply);
    }),

    http.post<{ paymentId: string }>(anyOrigin(API_ROUTES.confirmChallenge), async ({ params, request }) => {
      const input = await parseBody(request, confirmChallengeRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      return send(request, paymentReply(backend.confirmChallenge(params.paymentId, input.value.decision), request));
    }),
  ];
}
