// @vitest-environment node
import { describe, expect, it } from "vitest";
import { stockLevel, ticketCount } from "./ticketing";

describe("ticketing", () => {
  it("counts tickets across line items", () => {
    expect(
      ticketCount([
        { tierId: "a", quantity: 2 },
        { tierId: "b", quantity: 3 },
      ]),
    ).toBe(5);
  });

  it("calls five or fewer tickets 'low', and none 'sold out'", () => {
    expect([0, 1, 5, 6].map(stockLevel)).toEqual(["sold-out", "low", "low", "plenty"]);
  });
});
