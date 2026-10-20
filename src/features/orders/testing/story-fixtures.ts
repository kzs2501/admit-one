/** The order page's states for the component catalogue, worked out by the real `toOrderPageState`. */
import type { OrderDto } from "@/contract/dto";
import {
  attendeesFor,
  cardPayment,
  CONCERT,
  holdFor,
  orderFor,
  SUMMIT,
  type HoldScene,
} from "@/contract/testing/dto-fixtures";
import { ticketCount } from "@/core/ticketing";
import { toOrderPageState, type OrderPageState } from "@/features/orders/hooks/use-order-status";

type OrderShape = Partial<Pick<OrderDto, "status" | "payment" | "statusReason">>;

/** The order for a scene: everyone named, and the summit's lunch added where it's offered. */
export function sceneOrder(scene: HoldScene, shape: OrderShape) {
  const addOns = scene.eventSlug === SUMMIT.eventSlug ? { "fss-lunch": 2 } : {};
  return orderFor(holdFor(scene), { attendees: attendeesFor(ticketCount(scene.items)), addOns }, shape);
}

/** What the order page shows for this order. Throws if it isn't `kind`, so a story can't show something else. */
export function orderPageStateFor(
  kind: OrderPageState["kind"],
  shape: OrderShape,
  { scene = SUMMIT, isSlow = false }: { scene?: HoldScene; isSlow?: boolean } = {},
): OrderPageState {
  const state = toOrderPageState(sceneOrder(scene, shape), isSlow);
  if (state.kind !== kind) throw new Error(`This order shows "${state.kind}", not "${kind}"`);
  return state;
}

export { CONCERT, cardPayment };
