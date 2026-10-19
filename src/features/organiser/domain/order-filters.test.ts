import { describe, expect, it } from "vitest";
import { DEFAULT_ORDER_BY } from "@/contract/queries";
import { filtersFromSearchParams, filtersToSearchParams, hasAnyFilter, nextOrderBy } from "./order-filters";

const read = (query: string) => filtersFromSearchParams(new URLSearchParams(query));

describe("order filters in the URL", () => {
  it("survives a round trip through the URL", () => {
    const query =
      "event=lakeside-lights&status=fulfilled&status=refunded&method=upi&from=2026-10-01&to=2026-10-19&q=Rao&orderBy=totalMinor+asc";
    expect(filtersToSearchParams(read(query)).toString()).toBe(query);
  });

  it("drops each filter that makes no sense, and keeps the rest", () => {
    expect(
      read("status=lost&status=refunded&method=cash&from=19-10-2026&orderBy=price&q=%20%20&event=lakeside-lights"),
    ).toEqual({
      event: "lakeside-lights",
      status: ["refunded"],
      method: undefined,
      from: undefined,
      to: undefined,
      q: undefined,
      orderBy: DEFAULT_ORDER_BY,
    });
  });

  it("drops a date range that runs backwards, rather than guessing which end was meant", () => {
    expect(read("from=2026-10-19&to=2026-10-01")).toMatchObject({ from: undefined, to: undefined });
  });

  it("knows when nothing is filtered", () => {
    expect(hasAnyFilter(read(""))).toBe(false);
    expect(hasAnyFilter(read("orderBy=buyerName"))).toBe(false);
    expect(hasAnyFilter(read("status=failed"))).toBe(true);
  });
});

describe("sorting by a column", () => {
  it("starts a new column the useful way round, and flips the same one", () => {
    expect(nextOrderBy(DEFAULT_ORDER_BY, "totalMinor")).toEqual({ field: "totalMinor", isDescending: true });
    expect(nextOrderBy(DEFAULT_ORDER_BY, "buyerName")).toEqual({ field: "buyerName", isDescending: false });
    expect(nextOrderBy(DEFAULT_ORDER_BY, "createdAt")).toEqual({ field: "createdAt", isDescending: false });
  });
});
