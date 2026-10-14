/**
 * The checkout as a typed registry of steps. Each step says when it applies and
 * when it's complete; the flow a buyer sees is whatever applies to their order.
 * Navigation, progress and guards are written once against this list — no step
 * knows about any other step.
 */
import type { EventDto, HoldDto, OrderDto } from "@/contract/dto";
import { ticketCount } from "@/core/ticketing";
import { attendeesSchema } from "@/core/schemas";
import type { Draft } from "@/features/checkout/hooks/use-draft";
import { routes } from "@/lib/routes";

export type StepId = "attendees" | "add-ons" | "review" | "payment";

export interface StepContext {
  event: EventDto;
  hold: HoldDto;
  draft: Draft;
  order: OrderDto | null;
}

export interface Step {
  id: StepId;
  /** Short label for the progress list. */
  label: string;
  /** The step's heading. */
  title: string;
  isApplicable: (context: StepContext) => boolean;
  isComplete: (context: StepContext) => boolean;
}

/** The order on the server matches what's in the draft — nothing edited since. */
export function orderMatchesDraft(context: StepContext): boolean {
  const { order, draft } = context;
  if (!order || (order.status !== "pending" && order.status !== "failed")) return false;
  const hasSameAttendees =
    order.attendees.length === draft.attendees.length &&
    order.attendees.every((attendee, i) => {
      const typed = draft.attendees[i];
      if (!typed) return false;
      return attendee.name === typed.name.trim() && attendee.email === typed.email.trim();
    });
  const chosenAddOns = Object.entries(draft.addOns).filter(([, quantity]) => quantity > 0);
  const hasSameAddOns =
    chosenAddOns.length === Object.keys(order.addOns).length &&
    chosenAddOns.every(([addOnId, quantity]) => order.addOns[addOnId] === quantity);
  return hasSameAttendees && hasSameAddOns;
}

const STEPS: readonly Step[] = [
  {
    id: "attendees",
    label: "Attendees",
    title: "Who’s coming?",
    isApplicable: () => true,
    isComplete: ({ hold, draft }) => attendeesSchema(ticketCount(hold.items)).safeParse(draft.attendees).success,
  },
  {
    id: "add-ons",
    label: "Extras",
    title: "Add extras",
    isApplicable: ({ event }) => event.addOns.length > 0,
    isComplete: ({ draft }) => draft.hasConfirmedAddOns,
  },
  {
    id: "review",
    label: "Review",
    title: "Review your order",
    isApplicable: () => true,
    isComplete: orderMatchesDraft,
  },
  {
    id: "payment",
    label: "Payment",
    title: "Payment",
    isApplicable: () => true,
    isComplete: () => false, // the order page takes over once a payment is made
  },
];

export const applicableSteps = (context: StepContext) => STEPS.filter((step) => step.isApplicable(context));

export interface StepResolution {
  step: Step;
  shouldRedirect: boolean;
}

/**
 * Where should a buyer asking for `requested` actually be? On it if every earlier
 * step is complete; otherwise on the first incomplete step. An inapplicable or
 * unknown step sends them to the first step they still need.
 */
export function resolveStep(requested: string, context: StepContext): StepResolution {
  const flow = applicableSteps(context);
  const fallback = flow.find((step) => !step.isComplete(context)) ?? flow.at(-1);
  if (!fallback) throw new Error("A checkout always has at least one step.");
  const index = flow.findIndex((step) => step.id === requested);
  const target = flow[index];
  if (!target) return { step: fallback, shouldRedirect: true };
  const isBlocked = flow.slice(0, index).some((step) => !step.isComplete(context));
  return isBlocked ? { step: fallback, shouldRedirect: true } : { step: target, shouldRedirect: false };
}

export function nextStep(current: StepId, context: StepContext): Step | null {
  const flow = applicableSteps(context);
  return flow[flow.findIndex((step) => step.id === current) + 1] ?? null;
}

export function previousStep(current: StepId, context: StepContext): Step | null {
  const flow = applicableSteps(context);
  return flow[flow.findIndex((step) => step.id === current) - 1] ?? null;
}

export const stepHref = (holdId: string, step: StepId) => routes.checkoutStep(holdId, step);
