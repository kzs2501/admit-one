// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDER_BY,
  orderListParamsSchema,
  readOrderSearchParams,
  writeOrderSearchParams,
  type OrderFilters,
} from "./queries";

const parse = (query: string) => orderListParamsSchema.safeParse(readOrderSearchParams(new URLSearchParams(query)));

describe("order queries", () => {
  it("fills in the defaults for an empty query", () => {
    expect(parse("")).toMatchObject({ success: true, data: { status: [], orderBy: DEFAULT_ORDER_BY, pageSize: 50 } });
  });

  it("reads AIP-132 ordering: ascending unless it says desc", () => {
    expect(parse("orderBy=totalMinor")).toMatchObject({
      data: { orderBy: { field: "totalMinor", isDescending: false } },
    });
    expect(parse("orderBy=buyerName+desc")).toMatchObject({
      data: { orderBy: { field: "buyerName", isDescending: true } },
    });
    expect(parse("orderBy=price+desc").success).toBe(false);
  });

  it("refuses what it can't honour: unknown statuses, page sizes out of range, dates out of order", () => {
    expect(parse("status=lost").success).toBe(false);
    expect(parse("pageSize=0").success).toBe(false);
    expect(parse("pageSize=201").success).toBe(false);
    expect(parse("from=2026-10-20&to=2026-10-19").error?.issues[0]?.message).toBe(
      "The start date is after the end date.",
    );
    expect(parse("from=19-10-2026").success).toBe(false);
  });

  it("writes a canonical query that reads back the same: defaults left out, statuses sorted", () => {
    const filters: OrderFilters = {
      event: "lakeside-lights",
      status: ["refunded", "fulfilled"],
      method: "upi",
      from: "2026-10-01",
      to: "2026-10-19",
      q: "Rao",
      orderBy: { field: "totalMinor", isDescending: false },
    };
    const written = writeOrderSearchParams(filters, { pageSize: 100, pageToken: "abc" });
    expect(written.toString()).toBe(
      "event=lakeside-lights&status=fulfilled&status=refunded&method=upi&from=2026-10-01&to=2026-10-19&q=Rao&orderBy=totalMinor+asc&pageSize=100&pageToken=abc",
    );
    expect(parse(written.toString()).data).toEqual({
      ...filters,
      status: ["fulfilled", "refunded"],
      pageSize: 100,
      pageToken: "abc",
    });
    expect(writeOrderSearchParams({ status: [], orderBy: DEFAULT_ORDER_BY }, { pageSize: 50 }).toString()).toBe("");
  });
});
