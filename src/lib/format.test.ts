// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "@/core/catalog";
import { describeItems, formatMoney } from "./format";

describe("formatting", () => {
  it("formats money from cents", () => {
    expect(formatMoney(34402)).toBe("$344.02");
  });

  it("describes line items with their tier names", () => {
    const { tiers } = getEvent("frontend-systems-summit");
    expect(
      describeItems(tiers, [
        { tierId: "fss-general", quantity: 2 },
        { tierId: "fss-workshop", quantity: 1 },
      ]),
    ).toBe("2 × General, 1 × Workshop + General");
  });
});
