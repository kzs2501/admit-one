/**
 * Paying through Razorpay's test mode, on Postgres, against the in-memory fake of
 * Razorpay: the checkout the server opens for an order, and what it does when Razorpay
 * can't be reached or the order changes underneath it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerApi } from "@/backend/server";
import { createRazorpayClient, type RazorpayClient } from "@/backend/razorpay/client";
import { createFakeRazorpay } from "@/backend/razorpay/testing/fake-razorpay";
import { holdDetailsDtoSchema, orderDtoSchema, paymentResultDtoSchema } from "@/contract/dto";
import { problemSchema } from "@/contract/problems";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { signDemoTicket } from "@/core/demo-ticket-key";
import { createTestDatabase } from "./testing/database";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let nowMs = Date.UTC(2026, 9, 26, 6, 30);
let idCount = 0;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.drop());

const ORIGIN = "http://admit-one.test";
const MINUTE_MS = 60_000;

type ClientWrapper = (client: RazorpayClient) => RazorpayClient;

function setUp({ wrapClient = (client) => client }: { wrapClient?: ClientWrapper } = {}) {
  const razorpay = createFakeRazorpay({ now: () => nowMs });
  const api = createServerApi(
    database.db,
    {
      now: () => nowMs,
      newId: (prefix) => `${prefix}_rzp${String(++idCount)}`,
      random: () => 0,
      signTicket: signDemoTicket,
    },
    {
      webhookSecret: "whsec_razorpay_test",
      razorpay: wrapClient(createRazorpayClient(razorpay.settings, { fetch: razorpay.fetch })),
    },
  );
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    api.handle(
      new Request(ORIGIN + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  async function openOrder({
    eventSlug = "open-studio-ceramics",
    tierId = "osc-session",
  }: { eventSlug?: string; tierId?: string } = {}) {
    const held = await send("POST", "/api/holds", { eventSlug, items: [{ tierId, quantity: 1 }] });
    const { hold } = holdDetailsDtoSchema.pick({ hold: true }).parse(await held.json());
    const created = await send("POST", "/api/orders", {
      holdId: hold.id,
      attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
      addOns: {},
    });
    return { hold, order: orderDtoSchema.parse(await created.json()) };
  }

  const pay = (orderId: string, key = `key-${String(++idCount)}`, body: unknown = { method: "razorpay" }) =>
    send("POST", `/api/orders/${orderId}/payments`, body, { [IDEMPOTENCY_KEY_HEADER]: key });

  const readOrder = async (orderId: string) =>
    orderDtoSchema.parse(await (await send("GET", `/api/orders/${orderId}`)).json());

  return { razorpay, api, send, openOrder, pay, readOrder };
}

describe("paying through Razorpay's checkout", () => {
  it("is the one way to pay, once Razorpay is the provider", async () => {
    const { openOrder, pay } = setUp();
    const { order } = await openOrder();
    expect(order.paymentMethods).toEqual(["razorpay"]);

    const card = await pay(order.id, undefined, {
      method: "card",
      number: "4242424242424242",
      expiry: "12/30",
      cvc: "123",
      name: "Asha Rao",
    });
    expect(card.status).toBe(422);
    expect(problemSchema.parse(await card.json()).code).toBe("payment_method_unavailable");
  });

  it("opens a checkout on a Razorpay order for the order's total, payable while the hold is", async () => {
    const { razorpay, openOrder, pay, send } = setUp();
    const { hold, order } = await openOrder();

    const response = await pay(order.id);
    expect(response.status).toBe(202);
    const { payment } = paymentResultDtoSchema.parse(await response.json());
    expect(payment).toMatchObject({ method: "razorpay", status: "requires_action", last4: null });
    expect(payment.nextAction).toEqual({
      type: "razorpay_checkout",
      keyId: razorpay.settings.keyId,
      orderId: expect.stringMatching(/^order_/) as string,
      amountMinor: order.amounts.totalMinor,
      currency: "INR",
      expiresAt: new Date(nowMs + 5 * MINUTE_MS).toISOString(),
    });

    const providerOrder = razorpay.orders.get(
      payment.nextAction?.type === "razorpay_checkout" ? payment.nextAction.orderId : "",
    );
    expect(providerOrder).toMatchObject({
      amount: order.amounts.totalMinor,
      currency: "INR",
      receipt: payment.id,
      notes: { order_id: order.id, payment_id: payment.id },
    });

    // The checkout never outlasts the hold, which is kept for it.
    const details = holdDetailsDtoSchema.parse(await (await send("GET", `/api/holds/${hold.id}`)).json());
    expect(Date.parse(details.hold.expiresAt)).toBeGreaterThanOrEqual(nowMs + 5 * MINUTE_MS);
  });

  it("replays a retry with the same Idempotency-Key, and makes no second Razorpay order", async () => {
    const { razorpay, openOrder, pay } = setUp();
    const { order } = await openOrder();
    const first: unknown = await (await pay(order.id, "same-key")).json();
    const again: unknown = await (await pay(order.id, "same-key")).json();
    expect(again).toEqual(first);
    expect(razorpay.calls.filter((call) => call === "POST /orders")).toHaveLength(1);
  });

  it("makes no Razorpay order for an order that can't be paid", async () => {
    const { razorpay, openOrder, pay } = setUp();
    const { order } = await openOrder();
    nowMs += 6 * MINUTE_MS;
    const late = await pay(order.id);
    expect(problemSchema.parse(await late.json()).code).toBe("hold_expired");
    expect(razorpay.calls).not.toContain("POST /orders");
  });

  it("asks the buyer to try again when Razorpay can't be reached, and the same key works then", async () => {
    const { razorpay, openOrder, pay } = setUp();
    const { order } = await openOrder();
    razorpay.failNext("POST /orders", 503);
    const down = await pay(order.id, "retry-key");
    expect(down.status).toBe(503);
    expect(problemSchema.parse(await down.json()).code).toBe("service_unavailable");

    expect((await pay(order.id, "retry-key")).status).toBe(202);
  });

  it("refuses to open a checkout for an order whose price changed while Razorpay's order was made", async () => {
    let changeOrder: (() => Promise<unknown>) | null = null;
    const { razorpay, openOrder, pay, readOrder } = setUp({
      wrapClient: (client) => ({
        ...client,
        createOrder: async (input) => {
          await changeOrder?.();
          return client.createOrder(input);
        },
      }),
    });
    const { hold, order } = await openOrder({ eventSlug: "frontend-systems-summit", tierId: "fss-general" });
    const { send } = setUp();
    changeOrder = () =>
      send("POST", "/api/orders", {
        holdId: hold.id,
        attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
        addOns: { "fss-lunch": 1 },
      });

    const response = await pay(order.id);
    expect(response.status).toBe(409);
    expect(problemSchema.parse(await response.json()).code).toBe("invalid_state");
    expect(razorpay.orders.size).toBe(1);
    // Nothing was recorded: the buyer can pay the new total.
    expect((await readOrder(order.id)).payment).toBeNull();
    changeOrder = null;
    expect((await pay(order.id)).status).toBe(202);
  });

  it("closes the checkout with the hold, and says no money was taken", async () => {
    const { openOrder, pay, readOrder } = setUp();
    const { order } = await openOrder();
    await pay(order.id);
    nowMs += 5 * MINUTE_MS;
    const lapsed = await readOrder(order.id);
    expect(lapsed.payment).toMatchObject({ status: "failed", failureCode: "checkout_expired", nextAction: null });
    expect(lapsed.status).toBe("expired");
  });
});
