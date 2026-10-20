import { describe, expect, it } from "vitest";
import { orderDtoSchema } from "@/contract/dto";
import { storyArgs } from "@/lib/testing/stories";
import type { OrderPageState } from "@/features/orders/hooks/use-order-status";
import * as stories from "@/features/orders/components/order-status-view.stories";

const states = storyArgs(stories).map(([name, args]) => [name, args["state"] as OrderPageState] as const);

/** As for the checkout: the order page's fixtures are parsed with the contract's schemas. */
describe("order page stories match the API contract", () => {
  it.each(states)("%s", (_, state) => {
    if ("order" in state) orderDtoSchema.parse(state.order);
  });

  it("shows every state the order page can be in", () => {
    expect(new Set(states.map(([, state]) => state.kind))).toEqual(
      new Set([
        "loading",
        "not-found",
        "load-error",
        "awaiting-payment",
        "confirming",
        "fulfilled",
        "refunded",
        "expired",
        "failed",
      ]),
    );
  });
});
