/**
 * The HTTP contract: what every response looks like. The Zod schemas are the source
 * of truth — the types are inferred from them, and the client parses every response
 * against them at the boundary ("parse, don't validate").
 *
 * Timestamps are ISO 8601 strings; money is integer minor units, always with its
 * currency (ISO 4217).
 */
import { z } from "@/core/zod";
import { CURRENCIES } from "@/core/money";
import { PERMISSIONS, ROLES } from "@/core/organisations";
import { TAX_LINE_KINDS } from "@/core/pricing";
import { SEAT_ID_PATTERN } from "@/core/seating";
import {
  HOLD_STATUSES,
  ORDER_STATUSES,
  PAYMENT_FAILURE_CODES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  QUEUE_STATUSES,
} from "@/core/statuses";

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

/** A reserved seat, described well enough to print on a ticket. */
export const seatDtoSchema = z.object({
  id: z.string().regex(SEAT_ID_PATTERN),
  sectionName: z.string(),
  row: z.string(),
  number: z.number().int().positive(),
  tierId: z.string(),
});

/**
 * How an event is sold. For reserved seating, the hall's layout is static content
 * (shipped with the app, like the catalogue); only availability comes over the API.
 */
export const seatingDtoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("general") }),
  z.object({ kind: z.literal("reserved"), venueId: z.string() }),
]);

export const addOnDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Before tax. */
  priceMinor: minorUnitsSchema,
  /** GST on this extra, in basis points (500 = 5%). */
  gstRateBasisPoints: z.number().int().nonnegative(),
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
  seating: seatingDtoSchema,
  /** Live: whether this sale has a waiting room right now. */
  isQueueActive: z.boolean(),
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
  /** The seats held, for reserved seating; empty for general admission. */
  seats: z.array(seatDtoSchema),
});

export const attendeeDtoSchema = z.object({ name: z.string(), email: z.string() });

export const orderStatusSchema = z.enum(ORDER_STATUSES);

/** GST on one kind of thing in the order: tickets (or exempt tickets), the booking fee, or extras at one rate. */
export const taxLineDtoSchema = z.object({
  kind: z.enum(TAX_LINE_KINDS),
  rateBasisPoints: z.number().int().nonnegative(),
  taxableMinor: minorUnitsSchema,
  amountMinor: minorUnitsSchema,
});

/** What an order costs. Tickets and extras are before tax; `totalMinor` is what's charged, all in. */
export const amountsDtoSchema = z.object({
  currency: currencySchema,
  ticketsMinor: minorUnitsSchema,
  addOnsMinor: minorUnitsSchema,
  /** Booking fees. */
  feesMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
  taxLines: z.array(taxLineDtoSchema),
});

export const ticketDtoSchema = z.object({
  code: z.string(),
  attendeeName: z.string(),
  tierName: z.string(),
  seat: seatDtoSchema.nullable(),
});

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const paymentFailureCodeSchema = z.enum(PAYMENT_FAILURE_CODES);

/** What the buyer has to do before a payment can go on: answer their bank's 3-D Secure check, or approve in a UPI app. */
export const nextActionDtoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("card_challenge") }),
  z.object({
    type: z.literal("upi"),
    /** A `upi://pay` link: open it on a phone, or show it as a QR code to scan. */
    intentUri: z.string().startsWith("upi://pay?"),
    /** When the request stops being payable. */
    expiresAt: isoDateTimeSchema,
  }),
]);

export const paymentDtoSchema = z.object({
  id: z.string(),
  method: z.enum(PAYMENT_METHODS),
  status: paymentStatusSchema,
  /** The card's last four digits; null for UPI. */
  last4: z.string().nullable(),
  failureCode: paymentFailureCodeSchema.nullable(),
  /** Set while the status is `requires_action`. */
  nextAction: nextActionDtoSchema.nullable(),
});

export const orderDtoSchema = z.object({
  id: z.string(),
  holdId: z.string(),
  eventSlug: z.string(),
  items: z.array(lineItemDtoSchema),
  seats: z.array(seatDtoSchema),
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

/** A place in a sale's waiting room. Durations are whole seconds; the server says when to check again. */
export const queueEntryDtoSchema = z.object({
  token: z.string(),
  eventSlug: z.string(),
  status: z.enum(QUEUE_STATUSES),
  aheadCount: z.number().int().nonnegative(),
  aheadAtJoin: z.number().int().nonnegative(),
  estimatedWaitSeconds: z.number().int().nonnegative(),
  /** Ask again after this long; 0 when there's nothing left to wait for. */
  checkAgainAfterSeconds: z.number().int().nonnegative(),
  /** The end of your turn to reserve, once it has come. */
  admittedUntil: isoDateTimeSchema.nullable(),
  serverTime: isoDateTimeSchema,
});

/** Which seats are gone right now: sold, or held by someone. Everything else in the hall is free. */
export const seatAvailabilityDtoSchema = z.object({
  eventSlug: z.string(),
  unavailableSeatIds: z.array(z.string()),
  serverTime: isoDateTimeSchema,
});

export const permissionSchema = z.enum(PERMISSIONS);

/** Who's signed in to the organisers' dashboard, and what they may do. */
export const accountDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  organisation: z.object({ id: z.string(), name: z.string(), timeZone: z.string() }),
  permissions: z.array(permissionSchema),
});

/** A signed-in session: send `token` as `Authorization: Bearer <token>`. */
export const sessionDtoSchema = z.object({ token: z.string().min(1), account: accountDtoSchema });

/** An event as its organiser sees it, with what this account may do for it. */
export const organiserEventDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  startsAt: isoDateTimeSchema,
  timeZone: z.string(),
  currency: currencySchema,
  venue: z.string(),
  city: z.string(),
  permissions: z.array(permissionSchema),
});

export type LineItemDto = z.infer<typeof lineItemDtoSchema>;
export type TierDto = z.infer<typeof tierDtoSchema>;
export type SeatDto = z.infer<typeof seatDtoSchema>;
export type SeatingDto = z.infer<typeof seatingDtoSchema>;
export type SeatAvailabilityDto = z.infer<typeof seatAvailabilityDtoSchema>;
export type QueueEntryDto = z.infer<typeof queueEntryDtoSchema>;
export type AddOnDto = z.infer<typeof addOnDtoSchema>;
export type EventDto = z.infer<typeof eventDtoSchema>;
export type HoldDto = z.infer<typeof holdDtoSchema>;
export type AttendeeDto = z.infer<typeof attendeeDtoSchema>;
export type AmountsDto = z.infer<typeof amountsDtoSchema>;
export type TaxLineDto = z.infer<typeof taxLineDtoSchema>;
export type TicketDto = z.infer<typeof ticketDtoSchema>;
export type PaymentDto = z.infer<typeof paymentDtoSchema>;
export type NextActionDto = z.infer<typeof nextActionDtoSchema>;
export type OrderDto = z.infer<typeof orderDtoSchema>;
export type HoldDetailsDto = z.infer<typeof holdDetailsDtoSchema>;
export type PaymentResultDto = z.infer<typeof paymentResultDtoSchema>;
export type AccountDto = z.infer<typeof accountDtoSchema>;
export type SessionDto = z.infer<typeof sessionDtoSchema>;
export type OrganiserEventDto = z.infer<typeof organiserEventDtoSchema>;
