/** Test fixtures for the checkout: DTOs and step contexts, as the API would send them. */
import type { EventDto, HoldDto, OrderDto } from "@/contract/dto";
import { getEvent } from "@/core/catalog";
import type { OrderStatus } from "@/core/statuses";
import type { StepContext } from "@/features/checkout/domain/step-registry";
import type { Draft } from "@/features/checkout/hooks/use-draft";

const EPOCH = new Date(0).toISOString();

export function eventDtoFor(slug: string, available = 5): EventDto {
  const { tiers, addOns, ...event } = getEvent(slug);
  return {
    ...event,
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
});

export const testPeople = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Guest ${i + 1}`, email: `g${i + 1}@example.com` }));

/** The order the server would hold for this draft. */
export const orderDtoFor = (draft: Draft, status: OrderStatus = "pending"): OrderDto => ({
  id: "ord_1",
  holdId: "hold_1",
  eventSlug: "frontend-systems-summit",
  items: [],
  attendees: draft.attendees,
  addOns: Object.fromEntries(Object.entries(draft.addOns).filter(([, quantity]) => quantity > 0)),
  amounts: { currency: "INR", ticketsMinor: 0, addOnsMinor: 0, feesMinor: 0, totalMinor: 0 },
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
