/**
 * The HTTP contract: what every response looks like. The Zod schemas are the source
 * of truth — the types are inferred from them, and the client parses every response
 * against them at the boundary ("parse, don't validate").
 *
 * Timestamps are ISO 8601 strings; money is integer minor units, always with its
 * currency (ISO 4217).
 */
import * as z from "@/core/zod";
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
  REFUND_REASONS,
  REFUND_STATUSES,
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
  /** The ticket, signed: `ao1.<kid>.<payload>.<signature>` (Ed25519), verifiable offline. */
  token: z.string(),
});

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const paymentFailureCodeSchema = z.enum(PAYMENT_FAILURE_CODES);

/**
 * What the buyer has to do before a payment can go on: answer their bank's 3-D Secure
 * check, approve in a UPI app, or pay on Razorpay's checkout.
 */
export const nextActionDtoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("card_challenge") }),
  z.object({
    type: z.literal("upi"),
    /** A `upi://pay` link: open it on a phone, or show it as a QR code to scan. */
    intentUri: z.string().startsWith("upi://pay?"),
    /** When the request stops being payable. */
    expiresAt: isoDateTimeSchema,
  }),
  z.object({
    type: z.literal("razorpay_checkout"),
    /** Razorpay's public key (`rzp_test_…`), which Checkout opens with. */
    keyId: z.string().startsWith("rzp_"),
    /** Razorpay's order, which the checkout pays. */
    orderId: z.string(),
    amountMinor: minorUnitsSchema,
    currency: currencySchema,
    /** When the checkout stops being payable: close it then. */
    expiresAt: isoDateTimeSchema,
  }),
]);

export const paymentDtoSchema = z.object({
  id: z.string(),
  method: z.enum(PAYMENT_METHODS),
  status: paymentStatusSchema,
  /** The card's last four digits; null for UPI, and for Razorpay until a card has paid. */
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
  /** The ways it can be paid: what the backend's payment provider takes for this order. */
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
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

/** One order, as a row of the organiser's orders table. */
export const orderRowDtoSchema = z.object({
  id: z.string(),
  eventSlug: z.string(),
  eventName: z.string(),
  createdAt: isoDateTimeSchema,
  buyerName: z.string(),
  buyerEmail: z.string(),
  ticketCount: z.number().int().nonnegative(),
  totalMinor: minorUnitsSchema,
  currency: currencySchema,
  status: orderStatusSchema,
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  /** A refund asked for: on its way, or done. */
  refundStatus: z.enum(REFUND_STATUSES).nullable(),
});

/** A refund: pending until the payment provider's webhook says the money has gone back. */
export const refundDtoSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  reason: z.enum(REFUND_REASONS),
  status: z.enum(REFUND_STATUSES),
  createdAt: isoDateTimeSchema,
  settledAt: isoDateTimeSchema.nullable(),
});

/** A page of orders (AIP-158). `nextPageToken` is null on the last page; `totalSize` counts every match. */
export const orderPageDtoSchema = z.object({
  orders: z.array(orderRowDtoSchema),
  nextPageToken: z.string().nullable(),
  totalSize: z.number().int().nonnegative(),
});

/** One order in full, as its organiser sees it. */
/** An event's doors' list: the codes of its refunded tickets, as of a moment. */
export const doorListDtoSchema = z.object({
  eventSlug: z.string(),
  voidedCodes: z.array(z.string()),
  asOf: isoDateTimeSchema,
});

export const organiserOrderDtoSchema = orderRowDtoSchema.extend({
  items: z.array(z.object({ tierId: z.string(), tierName: z.string(), quantity: z.number().int().positive() })),
  seats: z.array(seatDtoSchema),
  addOns: z.array(z.object({ id: z.string(), name: z.string(), quantity: z.number().int().positive() })),
  amounts: amountsDtoSchema,
  attendees: z.array(attendeeDtoSchema),
  /** The card's last four digits; null for UPI, or before any payment. */
  last4: z.string().nullable(),
  refunds: z.array(refundDtoSchema),
});

export const refundResultDtoSchema = z.object({ refund: refundDtoSchema, order: organiserOrderDtoSchema });

/** Sales across an organiser's events, or for one (`?event=`). Days are in the organisation's time zone. */
export const salesMetricsDtoSchema = z.object({
  currency: currencySchema,
  timeZone: z.string(),
  revenue: z.object({ grossMinor: minorUnitsSchema, refundedMinor: minorUnitsSchema, netMinor: z.number().int() }),
  tickets: z.object({ sold: z.number().int().nonnegative(), capacity: z.number().int().nonnegative() }),
  tiers: z.array(
    z.object({
      eventSlug: z.string(),
      eventName: z.string(),
      tierId: z.string(),
      tierName: z.string(),
      sold: z.number().int().nonnegative(),
      capacity: z.number().int().nonnegative(),
    }),
  ),
  paidOrders: z.number().int().nonnegative(),
  averageOrderMinor: minorUnitsSchema,
  salesByDay: z.array(
    z.object({ date: z.iso.date(), tickets: z.number().int().nonnegative(), revenueMinor: minorUnitsSchema }),
  ),
  funnel: z.object({
    holds: z.number().int().nonnegative(),
    orders: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
    fulfilled: z.number().int().nonnegative(),
  }),
  paymentMethods: z.array(z.object({ method: z.enum(PAYMENT_METHODS), orders: z.number().int().nonnegative() })),
  webhookLag: z.object({
    p50Ms: z.number().int().nonnegative().nullable(),
    p95Ms: z.number().int().nonnegative().nullable(),
    samples: z.number().int().nonnegative(),
  }),
});

/**
 * The organisers' stream: an `ordersChanged` event names the events whose orders,
 * sales or refunds changed, so the dashboard re-reads what it's showing. It carries no
 * data itself, so there's one source of truth: the API. A `heartbeat` event comes every
 * 15 seconds, so idle connections aren't closed along the way.
 */
export const ordersChangedEventSchema = z.object({ eventSlugs: z.array(z.string()).min(1) });

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
export type DoorListDto = z.infer<typeof doorListDtoSchema>;
export type OrderRowDto = z.infer<typeof orderRowDtoSchema>;
export type OrderPageDto = z.infer<typeof orderPageDtoSchema>;
export type OrganiserOrderDto = z.infer<typeof organiserOrderDtoSchema>;
export type SalesMetricsDto = z.infer<typeof salesMetricsDtoSchema>;
export type RefundDto = z.infer<typeof refundDtoSchema>;
export type RefundResultDto = z.infer<typeof refundResultDtoSchema>;
export type OrdersChangedEvent = z.infer<typeof ordersChangedEventSchema>;
