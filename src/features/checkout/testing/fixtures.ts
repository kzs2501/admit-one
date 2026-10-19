/** Test fixtures for the checkout: DTOs and step contexts, as the API would send them. */
import type { EventDto, HoldDto, OrderDto, PaymentDto } from "@/contract/dto";
import { getEvent } from "@/core/catalog";
import type { OrderStatus } from "@/core/statuses";
import type { StepContext } from "@/features/checkout/domain/step-registry";
import { createEmptyDraft, type Draft } from "@/features/checkout/hooks/use-draft";

const EPOCH = new Date(0).toISOString();

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

export const holdDtoFor = (eventSlug: string, tierId: string, quantity: number): HoldDto => ({
  id: "hold_1",
  eventSlug,
  items: [{ tierId, quantity }],
  createdAt: EPOCH,
  expiresAt: EPOCH,
  status: "active",
  orderId: null,
  seats: [],
});

export const testPeople = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Guest ${i + 1}`, email: `g${i + 1}@example.com` }));

/** The order the server would hold for this draft. */
export const orderDtoFor = (draft: Draft, status: OrderStatus = "pending"): OrderDto => ({
  id: "ord_1",
  holdId: "hold_1",
  eventSlug: "frontend-systems-summit",
  items: [],
  seats: [],
  attendees: draft.attendees,
  addOns: Object.fromEntries(Object.entries(draft.addOns).filter(([, quantity]) => quantity > 0)),
  amounts: { currency: "INR", ticketsMinor: 0, addOnsMinor: 0, feesMinor: 0, taxMinor: 0, totalMinor: 0, taxLines: [] },
  status,
  statusReason: null,
  tickets: [],
  payment: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
});

/** Two General tickets for the summit, which has extras. */
export const summitContext = (draft: Draft, order: OrderDto | null = null): StepContext => ({
  event: eventDtoFor("frontend-systems-summit"),
  hold: holdDtoFor("frontend-systems-summit", "fss-general", 2),
  draft,
  order,
});

/** One ceramics session, an event with no extras. */
export const studioContext = (draft: Draft): StepContext => ({
  event: eventDtoFor("open-studio-ceramics"),
  hold: holdDtoFor("open-studio-ceramics", "osc-session", 1),
  draft,
  order: null,
});

export const UPI_INTENT = "upi://pay?pa=admit-one@example&pn=admit-one&mc=7922&tr=pay_1&tn=x&am=303.73&cu=INR";

/** A UPI payment as the API sends it: waiting for the buyer, unless it says otherwise. */
export const upiPaymentDto = (overrides: Partial<PaymentDto> = {}): PaymentDto => ({
  id: "pay_1",
  method: "upi",
  status: "requires_action",
  last4: null,
  failureCode: null,
  nextAction: { type: "upi", intentUri: UPI_INTENT, expiresAt: new Date(5 * 60_000).toISOString() },
  ...overrides,
});

/** An order with a total to pay, and the given payment. */
export const orderWithPayment = (payment: PaymentDto | null, status: OrderStatus = "pending"): OrderDto => ({
  ...orderDtoFor(createEmptyDraft(), status),
  amounts: { ...orderDtoFor(createEmptyDraft()).amounts, totalMinor: 30_373 },
  payment,
});
