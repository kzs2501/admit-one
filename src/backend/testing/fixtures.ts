/**
 * Test fixtures for the backend: a sandbox on a fake clock with deterministic ids,
 * and the steps of a purchase. Only tests import this.
 */
import { createBackend, type Backend } from "@/backend/backend";
import type { PresetId } from "@/backend/chaos/presets";
import type { Result } from "@/backend/domain/errors";
import { TEST_CARDS, type PaymentInput } from "@/backend/domain/payments";
import { createInitialState } from "@/backend/domain/state";
import { getEvent } from "@/core/catalog";
import { findSingleSeatGaps, type Seat, type SeatPlan } from "@/core/seating";

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

export const testCard = (number: string = TEST_CARDS.success): PaymentInput => ({
  method: "card",
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

export const SEATED_EVENT = "monsoon-strings";

/** The reserved-seating hall the catalogue uses. */
export function seatedPlan(): SeatPlan {
  const { seating } = getEvent(SEATED_EVENT);
  if (seating.kind !== "reserved") throw new Error(`${SEATED_EVENT} should have reserved seating`);
  return seating.plan;
}

const unavailableIn = (backend: Backend) =>
  new Set(valueOf(backend.getSeatAvailability(SEATED_EVENT)).unavailableSeatIds);

function* freeRuns(backend: Backend, length: number, tierId?: string) {
  const plan = seatedPlan();
  const unavailable = unavailableIn(backend);
  for (const section of plan.sections) {
    for (const row of section.rows) {
      if (tierId !== undefined && row.tierId !== tierId) continue;
      for (const block of row.blocks) {
        for (let start = 0; start + length <= block.length; start++) {
          const run = block.slice(start, start + length);
          if (!run.some((seat) => unavailable.has(seat.id))) yield { run, block, start, unavailable };
        }
      }
    }
  }
}

/** The first `length` free seats side by side that a buyer may take without stranding one. */
export function freeSeatRun(backend: Backend, length: number, tierId?: string): string[] {
  for (const { run, unavailable } of freeRuns(backend, length, tierId)) {
    const seatIds = run.map((seat) => seat.id);
    if (findSingleSeatGaps(seatedPlan(), unavailable, new Set(seatIds)).length === 0) return seatIds;
  }
  throw new Error(`No ${length} free seats together`);
}

/** Two free seats that would strand the free seat just before them (at an aisle, a row end or a taken seat). */
export function gapMakingSelection(backend: Backend): { seatIds: string[]; stranded: Seat } {
  for (const { run, block, start, unavailable } of freeRuns(backend, 3)) {
    const before = block[start - 1];
    const [stranded, ...rest] = run;
    if (stranded && (before === undefined || unavailable.has(before.id))) {
      return { seatIds: rest.map((seat) => seat.id), stranded };
    }
  }
  throw new Error("No selection that would strand a seat");
}
