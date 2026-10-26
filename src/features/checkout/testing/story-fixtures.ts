/**
 * Checkout screens for the component catalogue. Each state comes from the real
 * `deriveCheckout`, so a story shows exactly what the app would for that hold.
 */
import type { HoldDetailsDto, OrderDto, PaymentDto } from "@/contract/dto";
import { attendeesFor, eventDtoFor, holdFor, orderFor, type HoldScene } from "@/contract/testing/dto-fixtures";
import type { OrderStatus } from "@/core/statuses";
import { ticketCount } from "@/core/ticketing";
import { deriveCheckout, type CheckoutState } from "@/features/checkout/hooks/use-checkout";
import { createEmptyDraft, type Draft } from "@/features/checkout/hooks/use-draft";

export {
  attendeesFor,
  CONCERT,
  pendingRazorpayPayment,
  pendingUpiPayment,
  SUMMIT,
} from "@/contract/testing/dto-fixtures";

export interface CheckoutScene extends HoldScene {
  draft?: Partial<Draft>;
  /** Make the order the review step creates. */
  hasOrder?: boolean;
  payment?: PaymentDto | ((order: OrderDto) => PaymentDto);
  /** The ways the backend offers to pay: the sandbox's, unless the scene is server mode's. */
  paymentMethods?: OrderDto["paymentMethods"];
  orderStatus?: OrderStatus;
  /** Free tickets for the tier picker's "left" counts. */
  available?: number;
}

/** The hold, event and order, as `GET /api/holds/:id` returns them. */
export function holdDetailsFor(scene: CheckoutScene): HoldDetailsDto {
  const hold = holdFor(scene);
  const draft = { ...createEmptyDraft(), ...scene.draft };
  const ordered = scene.hasOrder ? orderFor(hold, draft, { status: scene.orderStatus ?? "pending" }) : null;
  const base = ordered && scene.paymentMethods ? { ...ordered, paymentMethods: scene.paymentMethods } : ordered;
  const order =
    base && scene.payment
      ? { ...base, payment: typeof scene.payment === "function" ? scene.payment(base) : scene.payment }
      : base;
  return {
    hold: { ...hold, orderId: order?.id ?? null },
    event: eventDtoFor(scene.eventSlug, scene.available),
    order,
    serverTime: new Date().toISOString(),
  };
}

/**
 * The checkout's state on `step`, worked out by the real view-model. Throws if the
 * scene doesn't allow that step, so a story can't quietly show something else.
 */
export function checkoutStateFor(step: string, scene: CheckoutScene): CheckoutState {
  const details = holdDetailsFor(scene);
  const { state } = deriveCheckout({
    requestedStep: step,
    details,
    error: null,
    fetchedAtMs: Date.now(),
    draft: { ...createEmptyDraft(), ...scene.draft },
    isMounted: true,
    hasExpiredLocally: false,
  });
  if (state.kind !== "ready" || state.step.id !== step) {
    throw new Error(
      `This scene can't be on "${step}": it resolves to ${state.kind === "ready" ? state.step.id : state.kind}`,
    );
  }
  return state;
}

/** A draft with everyone named, and the extras step answered. */
export const completeDraft = (scene: HoldScene, addOns: Draft["addOns"] = {}): Partial<Draft> => ({
  attendees: attendeesFor(ticketCount(scene.items)),
  addOns,
  hasConfirmedAddOns: true,
});
