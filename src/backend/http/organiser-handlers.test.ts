// @vitest-environment node
/**
 * The organisers' API contract: who's signed in, and the difference between 401, 403
 * and 404, as a client sees it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "@/backend/domain/access";
import { BASE_URL, createHttpHarness, expectProblem } from "@/backend/testing/http";
import {
  accountDtoSchema,
  orderPageDtoSchema,
  organiserEventDtoSchema,
  organiserOrderDtoSchema,
  sessionDtoSchema,
} from "@/contract/dto";

const { server, clock, call, post, bearer } = createHttpHarness();

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
});
