// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextDate, zonedDate, zonedDayStart } from "./time";

describe("days in a time zone", () => {
  it("puts 23:30 UTC on the next day in Kolkata, and the same day in UTC", () => {
    const lateEvening = Date.UTC(2026, 9, 18, 23, 30);
    expect(zonedDate(lateEvening, "Asia/Kolkata")).toBe("2026-10-19");
    expect(zonedDate(lateEvening, "UTC")).toBe("2026-10-18");
  });

  it("starts a Kolkata day at 18:30 UTC the evening before", () => {
    expect(zonedDayStart("2026-10-19", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 18, 18, 30));
    expect(zonedDayStart("2026-10-19", "UTC")).toBe(Date.UTC(2026, 9, 19));
  });

  it("finds a day's start across a daylight-saving change", () => {
    // London moves to GMT on 25 October 2026; the 26th starts at midnight GMT.
    expect(zonedDayStart("2026-10-26", "Europe/London")).toBe(Date.UTC(2026, 9, 26, 0, 0));
    expect(zonedDayStart("2026-10-24", "Europe/London")).toBe(Date.UTC(2026, 9, 23, 23, 0));
    expect(zonedDate(zonedDayStart("2026-10-25", "Europe/London"), "Europe/London")).toBe("2026-10-25");
  });

  it("counts on to the next day across month and year ends", () => {
    expect(nextDate("2026-10-31")).toBe("2026-11-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
  });
});
