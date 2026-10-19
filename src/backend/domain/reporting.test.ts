// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend, purchase, START_MS, valueOf } from "@/backend/testing/fixtures";
import { findAccount, type Account } from "@/core/organisations";
import { DEFAULT_ORDER_BY, DEFAULT_PAGE_SIZE, type OrderListParams } from "@/contract/queries";

const account = (id: string): Account => {
  const found = findAccount(id);
  if (!found) throw new Error(`No demo account ${id}`);
  return found;
};
const lakesideOwner = account("acc-lakeside-owner");
const rangmanchOwner = account("acc-rangmanch-owner");
const params = (overrides: Partial<OrderListParams> = {}): OrderListParams => ({
  status: [],
  orderBy: DEFAULT_ORDER_BY,
  pageSize: DEFAULT_PAGE_SIZE,
  ...overrides,
});

type Backend = ReturnType<typeof createTestBackend>["backend"];

/** Follow page tokens from the given page to the last, collecting every id. */
function walkPages(backend: Backend, who: Account, query: OrderListParams) {
  const ids: string[] = [];
  let pageToken = query.pageToken;
  do {
    const page = valueOf(backend.listOrders(who, { ...query, pageToken }));
    ids.push(...page.orders.map((row) => row.id));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

const allIds = (backend: Backend, who: Account, query: OrderListParams) =>
  valueOf(backend.exportOrders(who, query)).map((row) => row.id);

describe("listing orders", () => {
  const { backend } = createTestBackend();

  it("pages through every match exactly once, in order", () => {
    const festival = params({ event: "lakeside-lights", orderBy: { field: "totalMinor", isDescending: true } });
    const all = allIds(backend, lakesideOwner, festival);
    expect(valueOf(backend.listOrders(lakesideOwner, festival)).totalSize).toBe(all.length);
    expect(walkPages(backend, lakesideOwner, { ...festival, pageSize: 200 })).toEqual(all);
  });

  it("sorts names the way people read them, with the id breaking ties", () => {
    const rows = valueOf(
      backend.exportOrders(lakesideOwner, params({ orderBy: { field: "buyerName", isDescending: false } })),
    );
    const names = rows.slice(0, 50).map((row) => row.buyerName);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, "en-IN")));
    const sameName = rows.filter((row) => row.buyerName === rows[0]?.buyerName).map((row) => row.id);
    expect(sameName).toEqual([...sameName].sort());
  });

  it("filters by status, method and search, and only ever shows the account's own events", () => {
    const refundedUpi = valueOf(backend.exportOrders(lakesideOwner, params({ status: ["refunded"], method: "upi" })));
    expect(refundedUpi.length).toBeGreaterThan(0);
    expect(refundedUpi.every((row) => row.status === "refunded" && row.paymentMethod === "upi")).toBe(true);

    expect(allIds(backend, lakesideOwner, params({ q: "ORD_H00001" }))).toContain("ord_h00001");
    const first = valueOf(backend.exportOrders(lakesideOwner, params()))[0];
    const byName = valueOf(backend.exportOrders(lakesideOwner, params({ q: first?.buyerName.toUpperCase() })));
    expect(byName.every((row) => row.buyerName === first?.buyerName)).toBe(true);

    const theirs = valueOf(backend.exportOrders(rangmanchOwner, params()));
    expect(new Set(theirs.map((row) => row.eventSlug))).toEqual(new Set(["open-studio-ceramics", "monsoon-strings"]));
    expect(backend.listOrders(rangmanchOwner, params({ event: "lakeside-lights" }))).toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("refuses a page token from another query, and one that isn't a token at all", () => {
    const token = valueOf(backend.listOrders(lakesideOwner, params({ pageSize: 10 }))).nextPageToken ?? "";
    expect(backend.listOrders(lakesideOwner, params({ method: "card", pageToken: token }))).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(backend.listOrders(lakesideOwner, params({ pageToken: "not-a-token" }))).toMatchObject({
      error: { code: "invalid_request" },
    });
    // The page size may change from page to page; the query may not.
    expect(backend.listOrders(lakesideOwner, params({ pageSize: 25, pageToken: token })).ok).toBe(true);
  });
});

describe("listing orders as they arrive", () => {
  it("neither repeats nor skips an order when a new one arrives between pages", () => {
    const { backend, clock } = createTestBackend();
    const ceramics = params({
      event: "open-studio-ceramics",
      orderBy: { field: "createdAt", isDescending: false },
      pageSize: 2,
    });
    for (let i = 0; i < 3; i++) {
      purchase(backend, { quantity: 1 });
      clock.advance(1_000);
    }
    const before = allIds(backend, rangmanchOwner, ceramics);

    const first = valueOf(backend.listOrders(rangmanchOwner, ceramics));
    purchase(backend, { quantity: 1 }); // arrives while the organiser reads page one
    const rest = walkPages(backend, rangmanchOwner, { ...ceramics, pageToken: first.nextPageToken ?? undefined });
    const seen = [...first.orders.map((row) => row.id), ...rest];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice(0, before.length)).toEqual(before);
    expect(seen).toHaveLength(before.length + 1);
  });

  it("counts an order on the organiser's day: 23:59 and 00:00 in Kolkata are different days", () => {
    const { backend, clock } = createTestBackend();
    // START_MS is 15:30 in Kolkata on 12 October; midnight there is 18:30 UTC.
    clock.advance(Date.UTC(2026, 9, 12, 18, 29, 59, 999) - START_MS);
    const lateOn12th = purchase(backend, { quantity: 1 }).order.id;
    clock.advance(1);
    const earlyOn13th = purchase(backend, { quantity: 1 }).order.id;
    const on13th = allIds(backend, rangmanchOwner, params({ from: "2026-10-13", to: "2026-10-13" }));
    expect(on13th).toEqual([earlyOn13th]);
    expect(allIds(backend, rangmanchOwner, params({ to: "2026-10-12" }))).toContain(lateOn12th);
  });
});

describe("one order", () => {
  it("shows an organiser their own order in full, and another organiser's as not found", () => {
    const { backend } = createTestBackend();
    const { order } = purchase(backend, { quantity: 2 });
    expect(valueOf(backend.getOrganiserOrder(rangmanchOwner, order.id))).toMatchObject({
      buyerName: "Guest 1",
      ticketCount: 2,
      attendees: order.attendees,
      items: [{ tierId: "osc-session", tierName: "Two-hour session", quantity: 2 }],
    });
    expect(backend.getOrganiserOrder(lakesideOwner, order.id)).toMatchObject({ error: { code: "not_found" } });
    expect(backend.getOrganiserOrder(lakesideOwner, "ord_nope")).toMatchObject({ error: { code: "not_found" } });
    const historical = valueOf(backend.getOrganiserOrder(lakesideOwner, "ord_h00001"));
    expect(historical).toMatchObject({ id: "ord_h00001", eventName: "Lakeside Lights Festival" });
  });
});
