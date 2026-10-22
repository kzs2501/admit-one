/**
 * The server API as the route handler uses it. A webhook that fails to be acted on (here,
 * signing its tickets throws) is tried again later; it never fails a buyer's read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerApi, DELIVERY_ENDPOINT } from "@/backend/server";
import { TEST_CARDS } from "@/backend/domain/payments";
import { signDemoTicket } from "@/core/demo-ticket-key";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { SERVER_SETTINGS } from "./records";
import { createTestDatabase } from "./testing/database";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let nowMs = Date.UTC(2026, 9, 22, 6, 30);
let idCount = 0;
let isSigningBroken = true;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.drop());

const ORIGIN = "http://admit-one.test";

describe("the server API", () => {
  it("answers a buyer's read while a webhook keeps failing, and acts on it once it can", async () => {
    const api = createServerApi(
      database.db,
      {
        now: () => nowMs,
        newId: (prefix) => `${prefix}_${String(++idCount)}`,
        random: () => 0,
        signTicket: (claims) => {
          if (isSigningBroken) throw new Error("The signing key is unavailable");
          return signDemoTicket(claims);
        },
      },
      { webhookSecret: "whsec_server_api" },
    );
    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
      (
        await api.handle(
          new Request(ORIGIN + path, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
          }),
        )
      ).json() as Promise<{ hold?: { id: string }; id?: string }>;
    const readOrder = (id: string) => api.handle(new Request(`${ORIGIN}/api/orders/${id}`));

    const held = await post("/api/holds", {
      eventSlug: "open-studio-ceramics",
      items: [{ tierId: "osc-session", quantity: 1 }],
    });
    const order = await post("/api/orders", {
      holdId: held.hold?.id,
      attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
      addOns: {},
    });
    const orderId = order.id ?? "";
    await post(
      `/api/orders/${orderId}/payments`,
      { method: "card", number: TEST_CARDS.success, expiry: "12 / 30", cvc: "123", name: "Asha Rao" },
      { [IDEMPOTENCY_KEY_HEADER]: "server-api-key-1" },
    );

    nowMs += SERVER_SETTINGS.webhookDelayMs;
    const whileBroken = await readOrder(orderId);
    expect(whileBroken.status).toBe(200);
    // The failed delivery changed nothing: the order still waits for its payment.
    expect(await whileBroken.json()).toMatchObject({ status: "pending" });

    isSigningBroken = false;
    nowMs += 1_000;
    expect(await (await readOrder(orderId)).json()).toMatchObject({ status: "fulfilled" });
  });

  it("lets a scheduler deliver what's due, with its secret, and nobody else", async () => {
    const deps = {
      now: () => nowMs,
      newId: (prefix: string) => `${prefix}_${String(++idCount)}`,
      random: () => 0,
      signTicket: signDemoTicket,
    };
    const ask = (api: ReturnType<typeof createServerApi>, authorization?: string) =>
      api.handle(
        new Request(ORIGIN + DELIVERY_ENDPOINT, { headers: authorization ? { Authorization: authorization } : {} }),
      );
    const off = createServerApi(database.db, deps, { webhookSecret: "whsec_server_api" });
    expect((await ask(off, "Bearer anything")).status).toBe(404);

    const on = createServerApi(database.db, deps, { webhookSecret: "whsec_server_api", deliverySecret: "cron-secret" });
    const refused = await ask(on, "Bearer not-the-secret");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect((await ask(on)).status).toBe(401);
    const allowed = await ask(on, "Bearer cron-secret");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toHaveProperty("delivered");
  });

  it("answers a failure nobody planned for as a problem: retry later if it was the database, a 500 if not", async () => {
    const failingWith = (error: Error) =>
      createServerApi(
        database.db,
        {
          now: () => nowMs,
          newId: () => {
            throw error;
          },
          random: () => 0,
          signTicket: signDemoTicket,
        },
        { webhookSecret: "whsec_server_api" },
      );
    const reserve = (api: ReturnType<typeof createServerApi>) =>
      api.handle(
        new Request(`${ORIGIN}/api/holds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] }),
        }),
      );
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const busy = await reserve(failingWith(deadlock));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBe("2");
    expect(busy.headers.get("Content-Type")).toContain("application/problem+json");
    expect(await busy.json()).toMatchObject({ code: "service_unavailable" });

    const bug = await reserve(failingWith(new TypeError("undefined is not a function")));
    expect(bug.status).toBe(500);
    expect(await bug.json()).toMatchObject({ code: "internal_error" });
  });
});
