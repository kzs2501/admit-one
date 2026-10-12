/**
 * Validation shared by the forms (client) and the request handlers (server), so the
 * two can never disagree about what a valid attendee or card looks like.
 */
import { z } from "zod";
import { MAX_TICKETS_PER_ORDER } from "./catalog";

export const lineItemSchema = z.object({
  tierId: z.string().min(1),
  qty: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
});

export const createHoldSchema = z.object({
  eventSlug: z.string().min(1),
  items: z
    .array(lineItemSchema)
    .min(1, "Choose at least one ticket.")
    .refine((items) => items.reduce((n, i) => n + i.qty, 0) <= MAX_TICKETS_PER_ORDER, {
      message: `You can reserve up to ${MAX_TICKETS_PER_ORDER} tickets at a time.`,
    }),
});

export const attendeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the attendee's full name."),
  email: z.email("Enter a valid email address.").trim(),
});

/** Exactly one attendee per ticket. */
export const attendeesSchema = (ticketCount: number) =>
  z.array(attendeeSchema).length(ticketCount, `Add details for all ${ticketCount} tickets.`);

export const upsertOrderSchema = z.object({
  holdId: z.string().min(1),
  attendees: z.array(attendeeSchema).min(1),
  addOns: z.record(z.string(), z.number().int().min(0).max(MAX_TICKETS_PER_ORDER)),
});

/** Luhn checksum: catches mistyped card numbers before they reach the network. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const cardSchema = z.object({
  number: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .refine(passesLuhn, "That card number isn't valid."),
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

export type CardInput = z.input<typeof cardSchema>;
