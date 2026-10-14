/**
 * The HTTP contract: what every response looks like. The Zod schemas are the source
 * of truth — the types are inferred from them, and the client parses every response
 * against them at the boundary ("parse, don't validate").
 *
 * Timestamps are ISO 8601 strings; money is integer minor units, always with its
 * currency (ISO 4217).
 */
import { z } from "zod";
import { CURRENCIES } from "@/core/money";
import { HOLD_STATUSES, ORDER_STATUSES, PAYMENT_FAILURE_CODES, PAYMENT_STATUSES } from "@/core/statuses";

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const minorUnitsSchema = z.number().int().nonnegative();
const currencySchema = z.enum(CURRENCIES);

export const lineItemDtoSchema = z.object({ tierId: z.string(), quantity: z.number().int().positive() });

export const tierDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priceMinor: minorUnitsSchema,
  /** Live: tickets left right now, after sales and other buyers' holds. */
  available: z.number().int().nonnegative(),
});

export const addOnDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priceMinor: minorUnitsSchema,
});

export const eventDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  startsAt: isoDateTimeSchema,
  /** IANA time zone of the venue: show event times in it. */
  timeZone: z.string(),
  /** The currency of every price at this event. */
  currency: currencySchema,
  venue: z.string(),
  city: z.string(),
  description: z.string(),
  tiers: z.array(tierDtoSchema),
  addOns: z.array(addOnDtoSchema),
});

export const holdStatusSchema = z.enum(HOLD_STATUSES);

export const holdDtoSchema = z.object({
  id: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemDtoSchema),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  status: holdStatusSchema,
  orderId: z.string().nullable(),
});

export const attendeeDtoSchema = z.object({ name: z.string(), email: z.string() });

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const amountsDtoSchema = z.object({
  currency: currencySchema,
  ticketsMinor: minorUnitsSchema,
  addOnsMinor: minorUnitsSchema,
  feesMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
});

export const ticketDtoSchema = z.object({ code: z.string(), attendeeName: z.string(), tierName: z.string() });

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const paymentFailureCodeSchema = z.enum(PAYMENT_FAILURE_CODES);

export const paymentDtoSchema = z.object({
  id: z.string(),
  status: paymentStatusSchema,
  last4: z.string(),
  failureCode: paymentFailureCodeSchema.nullable(),
});

export const orderDtoSchema = z.object({
  id: z.string(),
  holdId: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemDtoSchema),
  attendees: z.array(attendeeDtoSchema),
  /** Add-on id → quantity; only add-ons that were chosen. */
  addOns: z.record(z.string(), z.number().int().positive()),
  amounts: amountsDtoSchema,
  status: orderStatusSchema,
  /** Why an order ended up refunded or expired, in plain words. */
  statusReason: z.string().nullable(),
  tickets: z.array(ticketDtoSchema),
  payment: paymentDtoSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/** A hold with its event and order, plus the server's clock so the client can correct for skew. */
export const holdDetailsDtoSchema = z.object({
  hold: holdDtoSchema,
  event: eventDtoSchema,
  order: orderDtoSchema.nullable(),
  serverTime: isoDateTimeSchema,
});

export const paymentResultDtoSchema = z.object({ payment: paymentDtoSchema, order: orderDtoSchema });

export type LineItemDto = z.infer<typeof lineItemDtoSchema>;
export type TierDto = z.infer<typeof tierDtoSchema>;
export type AddOnDto = z.infer<typeof addOnDtoSchema>;
export type EventDto = z.infer<typeof eventDtoSchema>;
export type HoldDto = z.infer<typeof holdDtoSchema>;
export type AttendeeDto = z.infer<typeof attendeeDtoSchema>;
export type AmountsDto = z.infer<typeof amountsDtoSchema>;
export type TicketDto = z.infer<typeof ticketDtoSchema>;
export type PaymentDto = z.infer<typeof paymentDtoSchema>;
export type OrderDto = z.infer<typeof orderDtoSchema>;
export type HoldDetailsDto = z.infer<typeof holdDetailsDtoSchema>;
export type PaymentResultDto = z.infer<typeof paymentResultDtoSchema>;
