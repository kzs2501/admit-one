// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getEvent } from "@/core/catalog";
import { describeItems, formatEventDate, formatEventTime, formatMoney, formatSeat, formatSeats } from "./format";

describe("formatting", () => {
  it("formats money from minor units, in its own currency", () => {
    expect(formatMoney(257500, "INR")).toBe("₹2,575.00");
    expect(formatMoney(112249400, "INR")).toBe("₹11,22,494.00"); // Indian digit grouping
    expect(formatMoney(34402, "USD")).toBe("$344.02");
  });

  it("shows event times in the venue's time zone", () => {
    const startsAt = "2026-12-05T11:00:00+05:30";
    expect(formatEventDate(startsAt, "Asia/Kolkata")).toBe("Sat, 5 Dec, 2026");
    expect(formatEventTime(startsAt, "Asia/Kolkata")).toBe("11:00\u00a0am");
    expect(formatEventTime(startsAt, "Europe/London")).toBe("5:30\u00a0am");
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

  it("names seats from the API the way a ticket prints them", () => {
    const seat = (row: string, number: number) => ({
      id: `stalls-${row}-${number}`,
      sectionName: "Stalls",
      row,
      number,
      tierId: "ms-premium",
    });
    expect(formatSeat(seat("F", 12))).toBe("Stalls, row F, seat 12");
    expect(formatSeats([seat("F", 13), seat("F", 12)])).toBe("Stalls F12–F13");
  });
});
