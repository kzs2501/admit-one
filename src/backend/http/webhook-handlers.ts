/**
 * The payment provider's webhook endpoint, in server mode. It reads the body as text,
 * exactly as sent, because the signature is over those bytes; the receiver checks it
 * before anything is parsed. A webhook it has already handled is acknowledged, so the
 * provider stops sending it; one about a payment it doesn't know yet is answered 404,
 * so the provider sends it again later.
 */
import { http } from "msw/http";
import type { Result } from "@/backend/domain/errors";
import { RAZORPAY_EVENT_ID_HEADER, RAZORPAY_SIGNATURE_HEADER } from "@/backend/razorpay/signatures";
import { API_ROUTES, WEBHOOK_SIGNATURE_HEADER } from "@/contract/routes";
import { anyOrigin, readText, type Kit } from "./kit";

export interface WebhookReceiverPort {
  receive: (rawBody: string, signature: string | null) => Promise<Result<string>>;
}

export function createWebhookHandlers(receiver: WebhookReceiverPort, { problemReply, send }: Kit) {
  return [
    http.post(anyOrigin(API_ROUTES.providerWebhook), async ({ request }) => {
      const rawBody = await readText(request);
      if (rawBody === null) {
        return send(
          request,
          problemReply({ code: "payload_too_large", detail: "The webhook body is over 64 KB." }, request),
        );
      }
      const result = await receiver.receive(rawBody, request.headers.get(WEBHOOK_SIGNATURE_HEADER));
      return send(
        request,
        result.ok
          ? { status: 200, body: { received: true, outcome: result.value } }
          : problemReply(result.error, request),
      );
    }),
  ];
}

export interface RazorpayWebhookReceiverPort {
  receive: (rawBody: string, signature: string | null, eventId: string | null) => Promise<Result<string>>;
}

/**
 * Razorpay's webhook endpoint, when it's the provider. An event about an order that
 * isn't this server's (another app on the same account) is acknowledged, so Razorpay
 * doesn't keep sending it: Razorpay's order is made before the checkout opens, so no
 * payment can be ahead of the record of it.
 */
export function createRazorpayWebhookHandlers(receiver: RazorpayWebhookReceiverPort, { problemReply, send }: Kit) {
  return [
    http.post(anyOrigin(API_ROUTES.razorpayWebhook), async ({ request }) => {
      const rawBody = await readText(request);
      if (rawBody === null) {
        return send(
          request,
          problemReply({ code: "payload_too_large", detail: "The webhook body is over 64 KB." }, request),
        );
      }
      const result = await receiver.receive(
        rawBody,
        request.headers.get(RAZORPAY_SIGNATURE_HEADER),
        request.headers.get(RAZORPAY_EVENT_ID_HEADER),
      );
      return send(
        request,
        result.ok
          ? { status: 200, body: { received: true, outcome: result.value } }
          : problemReply(result.error, request),
      );
    }),
  ];
}
