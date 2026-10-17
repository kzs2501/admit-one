/**
 * Request bodies. The backend's HTTP layer parses every body against these before
 * anything reaches the domain; a body that doesn't parse is an `invalid_request`
 * (or `invalid_card`) problem.
 */
import { z } from "@/core/zod";
import { addOnSelectionSchema, attendeeSchema, cardSchema, lineItemsSchema, seatIdsSchema } from "@/core/schemas";

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

export const createPaymentRequestSchema = cardSchema;

/** The buyer's answer to the bank's 3-D Secure challenge. */
export const confirmChallengeRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export type CreateHoldRequest = z.input<typeof holdByTiersRequestSchema> | z.input<typeof holdBySeatsRequestSchema>;
export type UpsertOrderRequest = z.input<typeof upsertOrderRequestSchema>;
export type CreatePaymentRequest = z.input<typeof createPaymentRequestSchema>;
export type ConfirmChallengeRequest = z.input<typeof confirmChallengeRequestSchema>;
