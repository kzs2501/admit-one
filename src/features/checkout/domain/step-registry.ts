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

export type StepContext = {
  event: EventDto;
  hold: HoldDto;
  draft: Draft;
  order: OrderDto | null;
};

export type Step = {
  id: StepId;
  /** Short label for the progress list. */
  label: string;
  /** The step's heading. */
  title: string;
  isApplicable: (ctx: StepContext) => boolean;
  isComplete: (ctx: StepContext) => boolean;
};

/** The order on the server matches what's in the draft — nothing edited since. */
export function orderMatchesDraft(ctx: StepContext): boolean {
  const { order, draft } = ctx;
  if (!order || (order.status !== "pending" && order.status !== "failed")) return false;
  const sameAttendees =
    order.attendees.length === draft.attendees.length &&
    order.attendees.every(
      (a, i) => a.name === draft.attendees[i]?.name.trim() && a.email === draft.attendees[i]?.email.trim(),
    );
  const wanted = Object.fromEntries(Object.entries(draft.addOns).filter(([, q]) => q > 0));
  const sameAddOns =
    Object.keys(wanted).length === Object.keys(order.addOns).length &&
    Object.entries(wanted).every(([id, q]) => order.addOns[id] === q);
  return sameAttendees && sameAddOns;
}

export const steps: Step[] = [
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

export const applicableSteps = (ctx: StepContext) => steps.filter((s) => s.isApplicable(ctx));

export const isStepId = (value: string): value is StepId => steps.some((s) => s.id === value);

/**
 * Where should a buyer asking for `requested` actually be? On it if every earlier
 * step is complete; otherwise on the first incomplete step. An inapplicable or
 * unknown step sends them to the first step they still need.
 */
export function resolveStep(requested: string, ctx: StepContext): { step: Step; redirect: boolean } {
  const flow = applicableSteps(ctx);
  const firstIncomplete = flow.find((s) => !s.isComplete(ctx)) ?? flow[flow.length - 1];
  const index = flow.findIndex((s) => s.id === requested);
  if (index === -1) return { step: firstIncomplete, redirect: true };
  const blocked = flow.slice(0, index).some((s) => !s.isComplete(ctx));
  return blocked ? { step: firstIncomplete, redirect: true } : { step: flow[index], redirect: false };
}

export function nextStep(current: StepId, ctx: StepContext): Step | null {
  const flow = applicableSteps(ctx);
  return flow[flow.findIndex((s) => s.id === current) + 1] ?? null;
}

export function previousStep(current: StepId, ctx: StepContext): Step | null {
  const flow = applicableSteps(ctx);
  return flow[flow.findIndex((s) => s.id === current) - 1] ?? null;
}

export const stepHref = (holdId: string, step: StepId) => routes.checkoutStep(holdId, step);
