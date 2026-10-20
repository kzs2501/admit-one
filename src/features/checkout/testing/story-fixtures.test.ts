import { describe, expect, it } from "vitest";
import { eventDtoSchema, holdDtoSchema, orderDtoSchema } from "@/contract/dto";
import { storyArgs } from "@/lib/testing/stories";
import type { CheckoutState } from "@/features/checkout/hooks/use-checkout";
import * as stories from "@/features/checkout/components/checkout-flow.stories";

const states = storyArgs(stories).map(([name, args]) => [name, args["state"] as CheckoutState] as const);

/**
 * The catalogue's checkout screens are built from fixtures, not fetched. Parsing each
 * one with the contract's own schemas means an API change breaks the fixture here,
 * instead of leaving the catalogue showing data the server could never send.
 */
describe("checkout stories match the API contract", () => {
  it.each(states)("%s", (_, state) => {
    if (state.kind === "ready") {
      holdDtoSchema.parse(state.context.hold);
      eventDtoSchema.parse(state.context.event);
      orderDtoSchema.nullable().parse(state.context.order);
    }
    if (state.kind === "expired") {
      holdDtoSchema.parse(state.hold);
      eventDtoSchema.parse(state.event);
    }
  });

  it("checks every screen state", () => {
    expect(new Set(states.map(([, state]) => state.kind))).toEqual(
      new Set(["loading", "not-found", "load-error", "expired", "ready"]),
    );
  });
});
