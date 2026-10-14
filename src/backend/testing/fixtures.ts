/**
 * Test fixtures for the backend: a sandbox on a fake clock with deterministic ids,
 * and the steps of a purchase. Only tests import this.
 */
import { createBackend, type Backend } from "@/backend/backend";
import type { PresetId } from "@/backend/chaos/presets";
import type { Result } from "@/backend/domain/errors";
import { TEST_CARDS } from "@/backend/domain/payments";
import { createInitialState } from "@/backend/domain/state";
import type { CardDetails } from "@/core/schemas";

export const START_MS = Date.UTC(2026, 9, 12, 10, 0, 0);

/** A backend on a fake clock with deterministic ids. */
export function createTestBackend(presetId: PresetId = "happy") {
  let nowMs = START_MS;
  let idCount = 0;
  const clock = {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
  const backend = createBackend(
    { now: clock.now, newId: (prefix) => `${prefix}_${++idCount}`, random: () => 0.42 },
    createInitialState(presetId),
  );
  return { backend, clock };
}

/** Unwrap a successful result, or fail the test with the domain error. */
export function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.detail}`);
  return result.value;
}

export const testCard = (number: string = TEST_CARDS.success): CardDetails => ({
  number,
  expiry: "12 / 30",
  cvc: "123",
  name: "Asha Rao",
});

export const testAttendees = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Guest ${i + 1}`, email: `guest${i + 1}@example.com` }));

/** Reserve → order → pay, ending with a payment in flight. */
export function purchase(
  backend: Backend,
  { quantity = 2, eventSlug = "open-studio-ceramics", tierId = "osc-session", card = testCard() } = {},
) {
  const { hold } = valueOf(backend.createHold({ eventSlug, items: [{ tierId, quantity }] }));
  const { order } = valueOf(backend.upsertOrder({ holdId: hold.id, attendees: testAttendees(quantity), addOns: {} }));
  const payment = backend.createPayment(order.id, card);
  return { hold, order, payment };
}
