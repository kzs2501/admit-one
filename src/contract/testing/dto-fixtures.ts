/**
 * API responses as the server would send them, for stories and tests. Prices come
 * from the same pricing rules the server charges by, and times are relative to now:
 * under a fixed clock (the screenshot tests) they're fixed too. A unit test parses
 * each one with the contract's schemas, so they can't drift from the API.
 */
import type { EventDto, HoldDto, OrderDto, PaymentDto, SeatDto } from "@/contract/dto";
import { getEvent, getSeatPlan } from "@/core/catalog";
import { signDemoTicket } from "@/core/demo-ticket-key";
import { priceOrder } from "@/core/pricing";
import type { LineItem } from "@/core/ticketing";

export function eventDtoFor(slug: string, available = 5): EventDto {
  const { tiers, addOns, seating, ...event } = getEvent(slug);
  return {
    ...event,
    seating: seating.kind === "reserved" ? { kind: "reserved", venueId: seating.plan.venueId } : { kind: "general" },
    isQueueActive: false,
    tiers: tiers.map(({ id, name, description, priceMinor }) => ({ id, name, description, priceMinor, available })),
    addOns,
  };
}

const MINUTE_MS = 60_000;
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

const PEOPLE = [
  { name: "Asha Rao", email: "asha.rao@example.com" },
  { name: "Vikram Nair", email: "vikram.nair@example.com" },
  { name: "Meera Iyer", email: "meera.iyer@example.com" },
] as const;

export const attendeesFor = (count: number) => PEOPLE.slice(0, count).map((person) => ({ ...person }));

/** A hold on an event, made two minutes ago, with `minutesLeft` to go. */
export interface HoldScene {
  eventSlug: string;
  items: LineItem[];
  seatIds?: readonly string[];
  minutesLeft?: number;
}

function seatsFor(eventSlug: string, seatIds: readonly string[]): SeatDto[] {
  const seats = getSeatPlan(eventSlug).sections.flatMap((section) => section.rows.flatMap((row) => row.seats));
  return seatIds.map((id) => {
    const seat = seats.find((candidate) => candidate.id === id);
    if (!seat) throw new Error(`No seat ${id} at ${eventSlug}`);
    return { id: seat.id, sectionName: seat.sectionName, row: seat.rowLabel, number: seat.number, tierId: seat.tierId };
  });
}

export function holdFor({ eventSlug, items, seatIds = [], minutesLeft = 8 }: HoldScene): HoldDto {
  return {
    id: "hold_story",
    eventSlug,
    items,
    createdAt: isoIn(-2 * MINUTE_MS),
    expiresAt: isoIn(minutesLeft * MINUTE_MS),
    status: "active",
    orderId: null,
    seats: seatIds.length ? seatsFor(eventSlug, seatIds) : [],
  };
}

/** Ticket codes as the server issues them: short, and easy to read aloud at the door. */
const TICKET_CODES = ["K7F2-9QX4", "M3TD-8WPA", "R6HZ-2CNE"];

/** The order the server holds for this hold and draft, priced by the same rules it charges by. */
export function orderFor(
  hold: HoldDto,
  draft: { attendees: OrderDto["attendees"]; addOns: Readonly<Record<string, number>> },
  {
    status = "pending",
    payment = null,
    statusReason = null,
  }: Partial<Pick<OrderDto, "status" | "payment" | "statusReason">> = {},
): OrderDto {
  const event = getEvent(hold.eventSlug);
  const addOns = Object.fromEntries(Object.entries(draft.addOns).filter(([, quantity]) => quantity > 0));
  const isIssued = status === "fulfilled" || status === "refunded";
  const tierNames = hold.items.flatMap(({ tierId, quantity }) =>
    Array.from({ length: quantity }, () => event.tiers.find((tier) => tier.id === tierId)?.name ?? tierId),
  );
  return {
    id: "ord_story",
    holdId: hold.id,
    eventSlug: hold.eventSlug,
    items: hold.items,
    seats: hold.seats,
    attendees: draft.attendees,
    addOns,
    amounts: priceOrder(event, hold.items, addOns),
    status,
    statusReason,
    tickets: isIssued
      ? draft.attendees.map((attendee, i) => {
          const seat = hold.seats[i] ?? null;
          const ticket = {
            code: TICKET_CODES[i] ?? `CODE-${String(i)}`,
            attendeeName: attendee.name,
            tierName: tierNames[i] ?? "",
          };
          const token = signDemoTicket({
            ...ticket,
            eventSlug: hold.eventSlug,
            seat: seat ? `${seat.sectionName}, row ${seat.row}, seat ${String(seat.number)}` : null,
          });
          return { ...ticket, seat, token };
        })
      : [],
    payment,
    createdAt: isoIn(-MINUTE_MS),
    updatedAt: isoIn(0),
  };
}

export const cardPayment = (overrides: Partial<PaymentDto> = {}): PaymentDto => ({
  id: "pay_story",
  method: "card",
  status: "succeeded",
  last4: "4242",
  failureCode: null,
  nextAction: null,
  ...overrides,
});

/** A UPI request waiting for the buyer, payable for another `minutesLeft` minutes. */
export const pendingUpiPayment = (order: Pick<OrderDto, "amounts">, minutesLeft = 4): PaymentDto => ({
  id: "pay_story",
  method: "upi",
  status: "requires_action",
  last4: null,
  failureCode: null,
  nextAction: {
    type: "upi",
    intentUri: `upi://pay?pa=admit-one@example&pn=admit-one&mc=7922&tr=pay_story&tn=Order%20ord_story&am=${(
      order.amounts.totalMinor / 100
    ).toFixed(2)}&cu=INR`,
    expiresAt: isoIn(minutesLeft * MINUTE_MS),
  },
});

/** Two General tickets for the summit, which has extras. */
export const SUMMIT: HoldScene = {
  eventSlug: "frontend-systems-summit",
  items: [{ tierId: "fss-general", quantity: 2 }],
};

/** Two Premium seats at the concert hall. */
export const CONCERT: HoldScene = {
  eventSlug: "monsoon-strings",
  items: [{ tierId: "ms-premium", quantity: 2 }],
  seatIds: ["stalls-D-11", "stalls-D-12"],
};
