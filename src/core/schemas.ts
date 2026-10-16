/**
 * Validation rules shared by the forms (client) and the backend, so the two can never
 * disagree about what a valid attendee, ticket request or card looks like.
 */
import { z } from "@/core/zod";
import { MAX_TICKETS_PER_ORDER } from "./ticketing";

export const lineItemSchema = z.object({
  tierId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
});

export const lineItemsSchema = z
  .array(lineItemSchema)
  .min(1, "Choose at least one ticket.")
  .refine((items) => items.reduce((total, item) => total + item.quantity, 0) <= MAX_TICKETS_PER_ORDER, {
    message: `You can reserve up to ${MAX_TICKETS_PER_ORDER} tickets at a time.`,
  });

export const attendeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the attendee’s full name."),
  email: z.email("Enter a valid email address.").trim(),
});

export type Attendee = z.output<typeof attendeeSchema>;

/** Exactly one attendee per ticket. */
export const attendeesSchema = (ticketCount: number) =>
  z.array(attendeeSchema).length(ticketCount, `Add details for all ${ticketCount} tickets.`);

/** Add-on id → quantity. */
export const addOnSelectionSchema = z.record(z.string(), z.number().int().min(0).max(MAX_TICKETS_PER_ORDER));

/** Luhn checksum: catches mistyped card numbers before they reach the network. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Spaces and dashes are how people type card numbers; digits are what gets checked. */
export const normalizeCardNumber = (input: string) => input.replace(/[\s-]/g, "");

export const cardSchema = z.object({
  number: z.string().transform(normalizeCardNumber).refine(passesLuhn, "That card number isn’t valid."),
  expiry: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\s?\/\s?\d{2}$/, "Use MM / YY."),
  cvc: z
    .string()
    .trim()
    .regex(/^\d{3,4}$/, "3 or 4 digits."),
  name: z.string().trim().min(2, "Enter the name on the card."),
});

/** What the card form holds. */
export type CardInput = z.input<typeof cardSchema>;
/** What a validated card looks like: the number is digits only. */
export type CardDetails = z.output<typeof cardSchema>;
