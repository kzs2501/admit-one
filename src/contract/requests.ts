/**
 * Request bodies. The backend's HTTP layer parses every body against these before
 * anything reaches the domain; a body that doesn't parse is an `invalid_request`
 * (or `invalid_card`) problem.
 */
import * as z from "@/core/zod";
import { addOnSelectionSchema, attendeeSchema, cardSchema, lineItemsSchema, seatIdsSchema } from "@/core/schemas";
import { REFUND_REASONS } from "@/core/statuses";

/**
 * Reserve by tier: "two Premium". For an event with reserved seating, the server
 * chooses the best seats available — in one step, so no other buyer can take them in
 * between.
 */
export const holdByTiersRequestSchema = z.object({ eventSlug: z.string().min(1), items: lineItemsSchema });

/** Reserve particular seats (reserved seating only). Strict, so a body can't be both kinds at once. */
export const holdBySeatsRequestSchema = z.strictObject({ eventSlug: z.string().min(1), seatIds: seatIdsSchema });

/**
 * `POST /api/holds` takes either shape. They're told apart by `seatIds`, rather than
 * by trying both, so a bad body gets the error for the shape it was meant to be. The
 * by-tier shape predates seats and is unchanged: old clients keep working.
 */
export const createHoldRequestSchemaFor = (body: unknown) =>
  typeof body === "object" && body !== null && "seatIds" in body ? holdBySeatsRequestSchema : holdByTiersRequestSchema;

export const upsertOrderRequestSchema = z.object({
  holdId: z.string().min(1),
  attendees: z.array(attendeeSchema).min(1),
  addOns: addOnSelectionSchema,
});

/** Pay by card. `method` may be left out: card bodies predate it, and old clients keep working. */
export const cardPaymentRequestSchema = cardSchema.extend({ method: z.literal("card").default("card") });

/**
 * Pay by UPI. The server answers with a payment request to approve in a UPI app — by
 * opening its link on a phone, or scanning its QR code — so the body carries nothing else.
 */
export const upiPaymentRequestSchema = z.strictObject({ method: z.literal("upi") });

/**
 * Pay through Razorpay's checkout. The server answers with the checkout to open; the
 * buyer chooses a card, UPI or their bank on Razorpay's page, so nothing else is sent.
 */
export const razorpayPaymentRequestSchema = z.strictObject({ method: z.literal("razorpay") });

const methodOf = (body: unknown) =>
  typeof body === "object" && body !== null && "method" in body ? body.method : undefined;

/**
 * `POST /api/orders/:orderId/payments` takes any method, told apart by `method`, so a
 * bad body gets the error for the method it was meant for.
 */
export const createPaymentRequestSchemaFor = (body: unknown) => {
  const method = methodOf(body);
  if (method === "upi") return upiPaymentRequestSchema;
  if (method === "razorpay") return razorpayPaymentRequestSchema;
  return cardPaymentRequestSchema;
};

/** The buyer's answer to the bank's 3-D Secure challenge. */
export const confirmChallengeRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) });

/** Refund an order in full. The reason is recorded with the refund, as payment providers record it. */
export const createRefundRequestSchema = z.object({ reason: z.enum(REFUND_REASONS) });

/** Sign in to the organisers' dashboard as one of the demo accounts. */
export const createSessionRequestSchema = z.object({ accountId: z.string().min(1) });

export type CreateRefundRequest = z.input<typeof createRefundRequestSchema>;
export type CreateHoldRequest = z.input<typeof holdByTiersRequestSchema> | z.input<typeof holdBySeatsRequestSchema>;
export type UpsertOrderRequest = z.input<typeof upsertOrderRequestSchema>;
export type CreatePaymentRequest =
  | z.input<typeof cardPaymentRequestSchema>
  | z.input<typeof upiPaymentRequestSchema>
  | z.input<typeof razorpayPaymentRequestSchema>;
export type ConfirmChallengeRequest = z.input<typeof confirmChallengeRequestSchema>;
