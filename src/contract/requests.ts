/**
 * Request bodies. The backend's HTTP layer parses every body against these before
 * anything reaches the domain; a body that doesn't parse is an `invalid_request`
 * (or `invalid_card`) problem.
 */
import { z } from "@/core/zod";
import { addOnSelectionSchema, attendeeSchema, cardSchema, lineItemsSchema } from "@/core/schemas";

export const createHoldRequestSchema = z.object({ eventSlug: z.string().min(1), items: lineItemsSchema });

export const upsertOrderRequestSchema = z.object({
  holdId: z.string().min(1),
  attendees: z.array(attendeeSchema).min(1),
  addOns: addOnSelectionSchema,
});

export const createPaymentRequestSchema = cardSchema;

/** The buyer's answer to the bank's 3-D Secure challenge. */
export const confirmChallengeRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export type CreateHoldRequest = z.input<typeof createHoldRequestSchema>;
export type UpsertOrderRequest = z.input<typeof upsertOrderRequestSchema>;
export type CreatePaymentRequest = z.input<typeof createPaymentRequestSchema>;
export type ConfirmChallengeRequest = z.input<typeof confirmChallengeRequestSchema>;
