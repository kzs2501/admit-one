/**
 * The HTTP adapter: routing, request parsing, status codes, problem details,
 * idempotency keys and latency. Everything domain-related is delegated to the backend,
 * through its port; these handlers are as thin as a real API's controllers. The buyer's
 * API runs on either backend (the sandbox or Postgres); the waiting room and the
 * organisers' API are the sandbox's alone.
 */
import { http, HttpResponse } from "msw/http";
import type { Backend } from "@/backend/backend";
import type { BuyerPort } from "@/backend/port";
import type { Result } from "@/backend/domain/errors";
import type { PaymentResultView } from "@/backend/domain/views";
import {
  confirmChallengeRequestSchema,
  createHoldRequestSchemaFor,
  createPaymentRequestSchemaFor,
  upiPaymentRequestSchema,
  upsertOrderRequestSchema,
} from "@/contract/requests";
import { API_ROUTES, QUEUE_TOKEN_HEADER, RETRY_AFTER_HEADER } from "@/contract/routes";
import {
  toEventDto,
  toHoldDetailsDto,
  toOrderDto,
  toPaymentResultDto,
  toQueueEntryDto,
  toSeatAvailabilityDto,
} from "./mappers";
import { anyOrigin, createKit, pathOf, type HandlerOptions, type Kit, type Reply } from "./kit";
import { createOrganiserHandlers } from "./organiser-handlers";
import { createSlidingWindow } from "./rate-limit";

/** A card payment can fail as it's attempted; a UPI payment only fails later, by webhook. */
const CARD_FAILURE_DETAILS = {
  card_declined: "Your card was declined. Try a different card.",
  authentication_failed: "Authentication failed. Try again or use a different card.",
} as const;

const isCardFailure = (code: string | null): code is keyof typeof CARD_FAILURE_DETAILS =>
  code !== null && Object.hasOwn(CARD_FAILURE_DETAILS, code);

/** The sandbox's whole API. */
export function createHandlers(backend: Backend, options: HandlerOptions) {
  const kit = createKit(backend, options);
  return [
    ...createBuyerHandlers(backend, options, kit),
    ...createQueueHandlers(backend, kit),
    ...createOrganiserHandlers(backend, kit),
  ];
}

/** The waiting room: the sandbox's alone, since it's driven by its chaos presets. */
function createQueueHandlers(backend: Backend, { latency, problemReply, resultReply, send }: Kit) {
  return [
    http.post<{ slug: string }>(anyOrigin(API_ROUTES.joinQueue), async ({ params, request }) => {
      await latency();
      const result = backend.joinQueue(params.slug);
      return send(
        request,
        result.ok
          ? { status: result.value.isNew ? 201 : 200, body: toQueueEntryDto(result.value.entry) }
          : problemReply(result.error, request),
      );
    }),

    http.get<{ token: string }>(anyOrigin(API_ROUTES.getQueueEntry), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(backend.getQueueEntry(params.token), request, toQueueEntryDto));
    }),
  ];
}

/** The buyer's API: events, seats, holds, orders and payments, on either backend. */
export function createBuyerHandlers(
  backend: BuyerPort,
  { sleep, random, now }: HandlerOptions,
  kit: Kit = createKit(backend, { sleep, random }),
) {
  const holdAttempts = createSlidingWindow(now);
  const { latency, problemReply, resultReply, send, parseBody, withIdempotencyKey } = kit;

  // What the "connection drops" preset loses. The work has already happened; only the
  // answer goes missing — the case that makes retrying a payment dangerous without a key.
  const ordersWithLostPayment = new Set<string>();
  const statusCheckCounts = new Map<string, number>();
  const lostResponse = (request: Request) => {
    backend.log("warn", `${request.method} ${pathOf(request)} → the response was lost on the way back.`);
    return HttpResponse.error();
  };

  /**
   * Reservation attempts are rate-limited, refusals included (RFC 6585): a 429 that
   * says how long to wait, in a header any HTTP client understands and in the problem,
   * and that no cache may keep.
   */
  const rateLimitReply = (request: Request): Reply | null => {
    const limit = backend.chaos().holdRateLimit;
    if (!limit) return null;
    const decision = holdAttempts.take(limit);
    if (decision.isAllowed) return null;
    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    const problem = problemReply(
      {
        code: "rate_limited",
        detail: `Too many reservation attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
        retryAfterSeconds,
      },
      request,
    );
    return { ...problem, headers: { [RETRY_AFTER_HEADER]: String(retryAfterSeconds), "Cache-Control": "no-store" } };
  };

  /**
   * An attempted payment: 202 while it's processing or waiting for the buyer (a 3-D
   * Secure check, a UPI app), 402 when the bank said no.
   */
  function paymentReply(result: Result<PaymentResultView>, request: Request): Reply {
    if (!result.ok) return problemReply(result.error, request);
    const { payment } = result.value;
    if (payment.status === "failed" && isCardFailure(payment.failureCode)) {
      const code = payment.failureCode;
      return problemReply({ code, detail: CARD_FAILURE_DETAILS[code], paymentId: payment.id }, request);
    }
    return { status: 202, body: toPaymentResultDto(result.value) };
  }

  return [
    http.get(anyOrigin(API_ROUTES.listEvents), async ({ request }) => {
      await latency();
      return send(request, { status: 200, body: (await backend.listEvents()).map(toEventDto) });
    }),

    http.get<{ slug: string }>(anyOrigin(API_ROUTES.getEvent), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(await backend.getEvent(params.slug), request, toEventDto));
    }),

    http.get<{ slug: string }>(anyOrigin(API_ROUTES.getSeatAvailability), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(await backend.getSeatAvailability(params.slug), request, toSeatAvailabilityDto));
    }),

    http.post(anyOrigin(API_ROUTES.createHold), async ({ request }) => {
      const limited = rateLimitReply(request);
      if (limited) {
        await latency();
        return send(request, limited);
      }
      const input = await parseBody(request, createHoldRequestSchemaFor);
      await latency();
      if (!input.ok) return send(request, input.reply);
      return send(
        request,
        resultReply(
          await backend.createHold({ ...input.value, queueToken: request.headers.get(QUEUE_TOKEN_HEADER) }),
          request,
          toHoldDetailsDto,
          201,
        ),
      );
    }),

    http.get<{ holdId: string }>(anyOrigin(API_ROUTES.getHold), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(await backend.getHold(params.holdId), request, toHoldDetailsDto));
    }),

    http.post(anyOrigin(API_ROUTES.upsertOrder), async ({ request }) => {
      const input = await parseBody(request, upsertOrderRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      const result = await backend.upsertOrder(input.value);
      return send(
        request,
        result.ok
          ? { status: result.value.isCreated ? 201 : 200, body: toOrderDto(result.value.order) }
          : problemReply(result.error, request),
      );
    }),

    http.get<{ orderId: string }>(anyOrigin(API_ROUTES.getOrder), async ({ params, request }) => {
      await latency();
      const checkCount = (statusCheckCounts.get(params.orderId) ?? 0) + 1;
      statusCheckCounts.set(params.orderId, checkCount);
      if (checkCount > 1 && checkCount <= 1 + backend.chaos().droppedStatusChecks) return lostResponse(request);
      return send(request, resultReply(await backend.getOrder(params.orderId), request, toOrderDto));
    }),

    /**
     * Start a payment. The Idempotency-Key makes retries safe: a double-click or a retried
     * request can never charge twice (see `withIdempotencyKey`). Only attempted charges
     * are stored, so a request rejected before charging — an expired hold, an invalid
     * card — can be retried with the same key.
     */
    http.post<{ orderId: string }>(anyOrigin(API_ROUTES.createPayment), async ({ params, request }) => {
      const reply = await withIdempotencyKey(request, { what: "Payments" }, async (body) => {
        const schema = createPaymentRequestSchemaFor(body);
        const input = schema.safeParse(body);
        if (!input.success) {
          const detail = input.error.issues[0]?.message ?? "Check the payment details.";
          const code = schema === upiPaymentRequestSchema ? "invalid_request" : "invalid_card";
          return { reply: problemReply({ code, detail }, request), isAttempted: false };
        }
        const result = await backend.createPayment(params.orderId, input.data);
        return { reply: paymentReply(result, request), isAttempted: result.ok };
      });
      // The work happens *before* the response is delayed: that's what lets a webhook
      // beat the browser in the "webhook before redirect" preset.
      await latency(backend.chaos().extraPaymentLatencyMs);
      const shouldLoseResponse =
        reply.status === 202 &&
        backend.chaos().shouldDropFirstPaymentResponse &&
        !ordersWithLostPayment.has(params.orderId);
      if (shouldLoseResponse) {
        ordersWithLostPayment.add(params.orderId);
        return lostResponse(request);
      }
      return send(request, reply);
    }),

    http.post<{ paymentId: string }>(anyOrigin(API_ROUTES.confirmChallenge), async ({ params, request }) => {
      const input = await parseBody(request, confirmChallengeRequestSchema);
      await latency();
      if (!input.ok) return send(request, input.reply);
      return send(
        request,
        paymentReply(await backend.confirmChallenge(params.paymentId, input.value.decision), request),
      );
    }),

    /**
     * Cancel a payment the buyer hasn't approved, to pay another way: 200 with the
     * cancelled payment, the same again if repeated, 409 once it's too late.
     */
    http.post<{ paymentId: string }>(anyOrigin(API_ROUTES.cancelPayment), async ({ params, request }) => {
      await latency();
      return send(request, resultReply(await backend.cancelPayment(params.paymentId), request, toPaymentResultDto));
    }),
  ];
}
