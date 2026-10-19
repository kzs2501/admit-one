// @vitest-environment node
/**
 * The organisers' API contract: who's signed in, and the difference between 401, 403
 * and 404, as a client sees it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "@/backend/domain/access";
import { getHistory } from "@/backend/domain/history";
import { BASE_URL, createHttpHarness, expectProblem } from "@/backend/testing/http";
import {
  accountDtoSchema,
  orderPageDtoSchema,
  organiserEventDtoSchema,
  organiserOrderDtoSchema,
  refundResultDtoSchema,
  salesMetricsDtoSchema,
  sessionDtoSchema,
} from "@/contract/dto";

const { server, clock, call, post, bearer, backend } = createHttpHarness();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

async function signIn(accountId: string) {
  const response = await post("/api/session", { accountId });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return sessionDtoSchema.parse(await response.json());
}

describe("organisers' API", () => {
  it("signs in as a demo account, and refuses one that doesn't exist", async () => {
    const { account } = await signIn("acc-lakeside-owner");
    expect(account).toMatchObject({ role: "owner", organisation: { id: "lakeside-live" } });
    await expectProblem(await post("/api/session", { accountId: "acc-nobody" }), 422, "invalid_request");
  });

  it("answers 401 without a token, and says the token is invalid once it's signed out or expired", async () => {
    const missing = await call("/api/organiser/account");
    await expectProblem(missing, 401, "unauthenticated");
    expect(missing.headers.get("WWW-Authenticate")).toBe('Bearer realm="admit-one"');
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const { token } = await signIn("acc-lakeside-owner");
    const me = await call("/api/organiser/account", { headers: bearer(token) });
    expect(accountDtoSchema.parse(await me.json()).name).toBe("Nandini Rao");
    // The scheme is case-insensitive.
    expect((await call("/api/organiser/account", { headers: { Authorization: `bearer ${token}` } })).status).toBe(200);

    expect((await call("/api/session", { method: "DELETE", headers: bearer(token) })).status).toBe(204);
    expect((await call("/api/session", { method: "DELETE", headers: bearer(token) })).status).toBe(204);
    const signedOut = await call("/api/organiser/account", { headers: bearer(token) });
    await expectProblem(signedOut, 401, "unauthenticated");
    expect(signedOut.headers.get("WWW-Authenticate")).toBe('Bearer realm="admit-one", error="invalid_token"');

    const { token: later } = await signIn("acc-lakeside-owner");
    clock.advance(SESSION_TTL_MS);
    await expectProblem(await call("/api/organiser/account", { headers: bearer(later) }), 401, "unauthenticated");
  });

  it("lists only the account's own events, and forbids another organiser's", async () => {
    const { token } = await signIn("acc-rangmanch-owner");
    const events = organiserEventDtoSchema
      .array()
      .parse(await (await call("/api/organiser/events", { headers: bearer(token) })).json());
    expect(events.map((event) => event.slug)).toEqual(["open-studio-ceramics", "monsoon-strings"]);

    const theirs = await call("/api/organiser/events/lakeside-lights", { headers: bearer(token) });
    const problem = await expectProblem(theirs, 403, "forbidden");
    expect(problem.instance).toBe(`${BASE_URL}/api/organiser/events/lakeside-lights`);
    await expectProblem(await call("/api/organiser/events/nope", { headers: bearer(token) }), 404, "not_found");
    const own = await call("/api/organiser/events/monsoon-strings", { headers: bearer(token) });
    expect(organiserEventDtoSchema.parse(await own.json()).permissions).toContain("orders:refund");
  });

  it("reports sales across the account's events, or for one of them", async () => {
    const { token } = await signIn("acc-lakeside-owner");
    const all = salesMetricsDtoSchema.parse(
      await (await call("/api/organiser/metrics", { headers: bearer(token) })).json(),
    );
    const festival = salesMetricsDtoSchema.parse(
      await (await call("/api/organiser/metrics?event=lakeside-lights", { headers: bearer(token) })).json(),
    );
    expect(all.tickets.capacity).toBeGreaterThan(festival.tickets.capacity);
    expect(festival.tiers.map((tier) => tier.tierId)).toEqual(["llf-day", "llf-weekend", "llf-vip"]);
    await expectProblem(
      await call("/api/organiser/metrics?event=monsoon-strings", { headers: bearer(token) }),
      403,
      "forbidden",
    );
  });

  describe("orders", () => {
    const ownerToken = async () => (await signIn("acc-lakeside-owner")).token;

    it("pages through orders by token, filtered and sorted on the server", async () => {
      const token = await ownerToken();
      const query = "event=night-market-jazz&orderBy=totalMinor+desc&pageSize=10";
      const first = orderPageDtoSchema.parse(
        await (await call(`/api/organiser/orders?${query}`, { headers: bearer(token) })).json(),
      );
      expect(first.orders).toHaveLength(10);
      expect(first.totalSize).toBeGreaterThan(10);
      const totals = first.orders.map((row) => row.totalMinor);
      expect(totals).toEqual([...totals].sort((left, right) => right - left));

      const next = await call(`/api/organiser/orders?${query}&pageToken=${first.nextPageToken ?? ""}`, {
        headers: bearer(token),
      });
      const second = orderPageDtoSchema.parse(await next.json());
      expect(second.orders.some((row) => first.orders.some((seen) => seen.id === row.id))).toBe(false);
      expect(next.headers.get("Cache-Control")).toBe("no-store");
    });

    it("answers a query it can't honour with 422, and another organiser's event with 403", async () => {
      const token = await ownerToken();
      const sort = await call("/api/organiser/orders?orderBy=price", { headers: bearer(token) });
      expect((await expectProblem(sort, 422, "invalid_request")).detail).toMatch(/^Sort by createdAt/);
      await expectProblem(
        await call("/api/organiser/orders?event=monsoon-strings", { headers: bearer(token) }),
        403,
        "forbidden",
      );
      await expectProblem(await call("/api/organiser/orders"), 401, "unauthenticated");
    });

    it("exports the matching orders as a CSV attachment, guarded against formulas", async () => {
      const token = await ownerToken();
      const response = await call("/api/organiser/orders/export?event=night-market-jazz&status=fulfilled", {
        headers: bearer(token),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="lakeside-live-orders-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the BOM (Response.text() would strip it)
      const [header, ...records] = new TextDecoder().decode(bytes).trimEnd().split("\r\n");
      expect(header).toBe(
        "order_id,event,created_at_local,buyer_name,buyer_email,tickets,status,payment_method,total,currency",
      );
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.includes(",fulfilled,"))).toBe(true);
      expect(records[0]).toMatch(/,\d+\.\d{2},INR$/);
    });

    it("shows one order to its organiser, and answers 404 to anyone else", async () => {
      const token = await ownerToken();
      const response = await call("/api/organiser/orders/ord_h00001", { headers: bearer(token) });
      const order = organiserOrderDtoSchema.parse(await response.json());
      expect(order).toMatchObject({ id: "ord_h00001", eventSlug: "lakeside-lights" });
      expect(order.amounts.totalMinor).toBe(order.totalMinor);

      const { token: rangmanch } = await signIn("acc-rangmanch-owner");
      await expectProblem(
        await call("/api/organiser/orders/ord_h00001", { headers: bearer(rangmanch) }),
        404,
        "not_found",
      );
    });
  });

  describe("refunds", () => {
    const fulfilled = (eventSlug: string, nth = 0) =>
      getHistory().orders.filter((order) => order.eventSlug === eventSlug && order.status === "fulfilled")[nth]?.id ??
      "";
    const refund = (orderId: string, token: string, key: string, body: unknown = { reason: "requested_by_customer" }) =>
      post(`/api/organiser/orders/${orderId}/refunds`, body, { ...bearer(token), "Idempotency-Key": key });

    it("accepts a refund with 202, replays it for the same key, and refuses the key for another request", async () => {
      const { token } = await signIn("acc-lakeside-owner");
      const orderId = fulfilled("lakeside-lights", 0);
      const first = await refund(orderId, token, "refund-key-1");
      expect(first.status).toBe(202);
      const accepted = refundResultDtoSchema.parse(await first.json());
      expect(accepted).toMatchObject({ refund: { status: "pending", orderId }, order: { refundStatus: "pending" } });

      const replay = refundResultDtoSchema.parse(await (await refund(orderId, token, "refund-key-1")).json());
      expect(replay.refund.id).toBe(accepted.refund.id);
      expect(Object.keys(backend.getState().refunds)).toHaveLength(1);
      await expectProblem(
        await refund(orderId, token, "refund-key-1", { reason: "duplicate" }),
        422,
        "idempotency_key_reused",
      );
    });

    it("needs a key, a reason and the permission, and keeps each account's keys apart", async () => {
      const { token } = await signIn("acc-lakeside-owner");
      const orderId = fulfilled("lakeside-lights", 1);
      await expectProblem(
        await post(`/api/organiser/orders/${orderId}/refunds`, { reason: "other" }, bearer(token)),
        400,
        "missing_idempotency_key",
      );
      // A bad body isn't stored, so the same key works once it's fixed.
      await expectProblem(
        await refund(orderId, token, "refund-key-2", { reason: "felt like it" }),
        422,
        "invalid_request",
      );
      expect((await refund(orderId, token, "refund-key-2")).status).toBe(202);

      const { token: boxOffice } = await signIn("acc-lakeside-box-office");
      await expectProblem(await refund(fulfilled("lakeside-lights", 2), boxOffice, "refund-key-3"), 403, "forbidden");

      const { token: rangmanch } = await signIn("acc-rangmanch-owner");
      await expectProblem(await refund(fulfilled("lakeside-lights", 2), rangmanch, "refund-key-2"), 404, "not_found");
      // The same key value from another account is that account's own key.
      expect((await refund(fulfilled("monsoon-strings", 0), rangmanch, "refund-key-2")).status).toBe(202);
    });

    it("answers 502 when the provider won't start the refund, and stores nothing", async () => {
      backend.setPreset("refunds-fail");
      const { token } = await signIn("acc-lakeside-owner");
      const before = Object.keys(backend.getState().refunds).length;
      await expectProblem(await refund(fulfilled("lakeside-lights", 3), token, "refund-key-4"), 502, "refund_failed");
      expect(Object.keys(backend.getState().refunds)).toHaveLength(before);
      backend.setPreset("happy");
      expect((await refund(fulfilled("lakeside-lights", 3), token, "refund-key-4")).status).toBe(202);
    });
  });
});
