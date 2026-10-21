/**
 * The payment provider's webhook endpoint, in server mode. It reads the body as text,
 * exactly as sent, because the signature is over those bytes; the receiver checks it
 * before anything is parsed. A webhook it has already handled, or about a payment it
 * doesn't know, is acknowledged too, so the provider stops sending it.
 */
import { http } from "msw/http";
import type { Result } from "@/backend/domain/errors";
import { API_ROUTES, WEBHOOK_SIGNATURE_HEADER } from "@/contract/routes";
import { anyOrigin, type Kit } from "./kit";

export interface WebhookReceiverPort {
  receive: (rawBody: string, signature: string | null) => Promise<Result<string>>;
}

export function createWebhookHandlers(receiver: WebhookReceiverPort, { problemReply, send }: Kit) {
  return [
    http.post(anyOrigin(API_ROUTES.providerWebhook), async ({ request }) => {
      const result = await receiver.receive(await request.text(), request.headers.get(WEBHOOK_SIGNATURE_HEADER));
      return send(
        request,
        result.ok
          ? { status: 200, body: { received: true, outcome: result.value } }
          : problemReply(result.error, request),
      );
    }),
  ];
}
