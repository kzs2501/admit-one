/**
 * Razorpay's endpoints, mounted only when Razorpay is the provider: its webhooks, and
 * Checkout's signed result passed on by the buyer's browser. Either settles a payment;
 * whichever comes second finds it settled.
 */
import { http } from "msw/http";
import type { Result } from "@/backend/domain/errors";
import type { PaymentResultView } from "@/backend/domain/views";
import { RAZORPAY_EVENT_ID_HEADER, RAZORPAY_SIGNATURE_HEADER } from "@/backend/razorpay/signatures";
import { confirmRazorpayRequestSchema, type ConfirmRazorpayRequest } from "@/contract/requests";
import { API_ROUTES } from "@/contract/routes";
import { anyOrigin, readText, type Kit } from "./kit";
import { toPaymentResultDto } from "./mappers";

export interface RazorpayPort {
  receiveWebhook: (rawBody: string, signature: string | null, eventId: string | null) => Promise<Result<string>>;
  confirmCheckout: (paymentId: string, result: ConfirmRazorpayRequest) => Promise<Result<PaymentResultView>>;
}

export function createRazorpayHandlers(port: RazorpayPort, { parseBody, problemReply, send }: Kit) {
  return [
    /**
     * An event about an order that isn't ours (another app on the same account) is
     * acknowledged, so Razorpay doesn't keep sending it: Razorpay's order is made before
     * the checkout opens, so no payment can be ahead of the record of it.
     */
    http.post(anyOrigin(API_ROUTES.razorpayWebhook), async ({ request }) => {
      const rawBody = await readText(request);
      if (rawBody === null) {
        return send(
          request,
          problemReply({ code: "payload_too_large", detail: "The webhook body is over 64 KB." }, request),
        );
      }
      const result = await port.receiveWebhook(
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

    http.post<{ paymentId: string }>(anyOrigin(API_ROUTES.confirmRazorpayPayment), async ({ params, request }) => {
      const input = await parseBody(request, confirmRazorpayRequestSchema);
      if (!input.ok) return send(request, input.reply);
      const result = await port.confirmCheckout(params.paymentId, input.value);
      return send(
        request,
        result.ok ? { status: 200, body: toPaymentResultDto(result.value) } : problemReply(result.error, request),
      );
    }),
  ];
}
