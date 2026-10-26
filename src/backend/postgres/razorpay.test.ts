/**
 * Paying through Razorpay's test mode, on Postgres, against the in-memory fake of
 * Razorpay: the checkout the server opens for an order, and what it does when Razorpay
 * can't be reached or the order changes underneath it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerApi } from "@/backend/server";
import { createRazorpayClient, RazorpayError, type RazorpayClient } from "@/backend/razorpay/client";
import { createFakeRazorpay } from "@/backend/razorpay/testing/fake-razorpay";
import { holdDetailsDtoSchema, orderDtoSchema, paymentResultDtoSchema } from "@/contract/dto";
import { problemSchema } from "@/contract/problems";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { signDemoTicket } from "@/core/demo-ticket-key";
import { eq } from "drizzle-orm";
import { providerCommands } from "./schema";
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
  const deliverySecret = "cron_razorpay_test";
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
      deliverySecret,
      razorpay: {
        client: wrapClient(createRazorpayClient(razorpay.settings, { fetch: razorpay.fetch })),
        webhookSecret: razorpay.settings.webhookSecret,
      },
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
    // A festival day: enough tickets for every test here to sell some.
    eventSlug = "lakeside-lights",
    tierId = "llf-day",
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

  /** Open a checkout for the order: our payment, and the Razorpay order it pays. */
  async function startCheckout(orderId: string) {
    const { payment } = paymentResultDtoSchema.parse(await (await pay(orderId)).json());
    if (payment.nextAction?.type !== "razorpay_checkout") throw new Error("No checkout was opened.");
    return { paymentId: payment.id, providerOrderId: payment.nextAction.orderId };
  }

  /** Razorpay sends a webhook, signed; returns the response's status and outcome. */
  async function webhook(...args: Parameters<typeof razorpay.webhook>) {
    const { body, headers } = razorpay.webhook(...args);
    const response = await api.handle(
      new Request(ORIGIN + "/api/webhooks/razorpay", { method: "POST", headers, body }),
    );
    const reply = (await response.json()) as { outcome?: string; code?: string };
    return { status: response.status, outcome: reply.outcome ?? reply.code };
  }

  /** The browser passes on Checkout's result; returns the response's status, and its body. */
  async function confirm(paymentId: string, result: ReturnType<typeof razorpay.checkoutResult>) {
    const response = await send("POST", `/api/payments/${paymentId}/razorpay`, {
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    });
    return { status: response.status, body: (await response.json()) as unknown };
  }

  /** The scheduler's run. */
  const schedule = async () =>
    (await (
      await api.handle(
        new Request(ORIGIN + "/api/internal/deliver", { headers: { Authorization: `Bearer ${deliverySecret}` } }),
      )
    ).json()) as { delivered: number; swept: number };

  return { razorpay, api, send, openOrder, pay, readOrder, startCheckout, webhook, confirm, schedule };
}

const commandsFor = (paymentId: string) =>
  database.db.select().from(providerCommands).where(eq(providerCommands.paymentId, paymentId));

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

describe("Razorpay's webhooks", () => {
  it("fulfil the order on a captured payment, once", async () => {
    const { razorpay, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    const paid = razorpay.pay(providerOrderId);

    expect(await webhook("payment.captured", paid.id, { eventId: "evt_capture_1" })).toEqual({
      status: 200,
      outcome: "fulfilled",
    });
    const fulfilled = await readOrder(order.id);
    expect(fulfilled).toMatchObject({ status: "fulfilled", payment: { status: "succeeded", last4: "1111" } });
    expect(fulfilled.tickets).toHaveLength(1);

    expect((await webhook("payment.captured", paid.id, { eventId: "evt_capture_1" })).outcome).toBe("duplicate");
    expect((await webhook("payment.captured", paid.id)).outcome).toBe("already-settled");
    expect((await readOrder(order.id)).tickets).toEqual(fulfilled.tickets);
  });

  it("are refused when the signature doesn't match the body, or there's no event id", async () => {
    const { razorpay, api, openOrder, startCheckout } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    const { body, headers } = razorpay.webhook("payment.captured", razorpay.pay(providerOrderId).id);
    const post = (init: { body: string; headers: Record<string, string> }) =>
      api.handle(new Request(ORIGIN + "/api/webhooks/razorpay", { method: "POST", ...init }));

    const tampered = await post({ body: body.replace('"captured"', '"refunded"'), headers });
    expect(problemSchema.parse(await tampered.json()).code).toBe("invalid_signature");
    const unsigned = await post({ body, headers: { "Content-Type": "application/json" } });
    expect(unsigned.status).toBe(400);
    const anonymous = await post({ body, headers: { ...headers, "X-Razorpay-Event-Id": "" } });
    expect(problemSchema.parse(await anonymous.json()).code).toBe("invalid_request");
  });

  it("leave the checkout open after a failed attempt, for the buyer to try again", async () => {
    const { razorpay, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);

    const declined = razorpay.pay(providerOrderId, { status: "failed" });
    expect((await webhook("payment.failed", declined.id)).outcome).toBe("noted");
    expect(await readOrder(order.id)).toMatchObject({ status: "pending", payment: { status: "requires_action" } });

    const paid = razorpay.pay(providerOrderId, { method: "upi" });
    expect((await webhook("payment.captured", paid.id)).outcome).toBe("fulfilled");
    expect((await readOrder(order.id)).payment).toMatchObject({ status: "succeeded", last4: null });
  });

  it("are acknowledged, and left, when they're about someone else's order", async () => {
    const { razorpay, webhook } = setUp();
    const client = createRazorpayClient(razorpay.settings, { fetch: razorpay.fetch });
    const theirs = await client.createOrder({ amountMinor: 100, currency: "INR", receipt: "other-app", notes: {} });
    expect(await webhook("payment.captured", razorpay.pay(theirs.id).id)).toEqual({ status: 200, outcome: "not-ours" });
  });

  it("capture authorised money, then fulfil the order without waiting for another webhook", async () => {
    const { razorpay, api, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    const held = razorpay.pay(providerOrderId, { status: "authorized" });

    expect((await webhook("payment.authorized", held.id)).outcome).toBe("capturing");
    expect(razorpay.calls).not.toContain("POST /payments/:id/capture");
    expect(await api.deliverDue()).toBe(1);
    expect(razorpay.payments.get(held.id)?.status).toBe("captured");
    expect((await readOrder(order.id)).status).toBe("fulfilled");
    expect((await webhook("payment.captured", held.id)).outcome).toBe("already-settled");
  });

  it("settle a capture once when two deliveries of it race", async () => {
    const { razorpay, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    const paid = razorpay.pay(providerOrderId);

    const outcomes = await Promise.all([webhook("payment.captured", paid.id), webhook("payment.captured", paid.id)]);
    expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual(["already-settled", "fulfilled"]);
    expect((await readOrder(order.id)).tickets).toHaveLength(1);
  });
});

describe("Checkout's signed result", () => {
  it("settles the payment at once, without waiting for the webhook", async () => {
    const { razorpay, openOrder, startCheckout, confirm, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    const paid = razorpay.pay(providerOrderId);

    const confirmed = await confirm(paymentId, razorpay.checkoutResult(paid));
    expect(confirmed.status).toBe(200);
    expect(paymentResultDtoSchema.parse(confirmed.body)).toMatchObject({
      payment: { id: paymentId, status: "succeeded" },
      order: { status: "fulfilled" },
    });
    expect((await webhook("payment.captured", paid.id)).outcome).toBe("already-settled");
    expect((await confirm(paymentId, razorpay.checkoutResult(paid))).status).toBe(200);
    expect((await readOrder(order.id)).tickets).toHaveLength(1);
  });

  it("is refused unless Razorpay signed it, for this payment's own checkout", async () => {
    const { razorpay, openOrder, startCheckout, confirm, readOrder } = setUp();
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    const paid = razorpay.pay(providerOrderId);
    const result = razorpay.checkoutResult(paid);

    const forged = await confirm(paymentId, { ...result, razorpay_signature: "0".repeat(64) });
    expect(forged.status).toBe(400);
    expect(problemSchema.parse(forged.body).code).toBe("invalid_signature");

    // Signed by Razorpay, but for another order's checkout.
    const other = await openOrder();
    const elsewhere = await startCheckout(other.order.id);
    const theirs = razorpay.checkoutResult(razorpay.pay(elsewhere.providerOrderId));
    expect(problemSchema.parse((await confirm(paymentId, theirs)).body).code).toBe("invalid_state");
    // A pair Razorpay never made: this checkout's order, someone else's payment.
    const mixed = razorpay.checkoutResult({ ...paid, id: theirs.razorpay_payment_id });
    expect(problemSchema.parse((await confirm(paymentId, mixed)).body).code).toBe("invalid_state");
    expect((await readOrder(order.id)).status).toBe("pending");
  });

  it("settles nothing when what Razorpay says is that nothing was paid", async () => {
    const { razorpay, openOrder, startCheckout, confirm, readOrder } = setUp();
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    const declined = razorpay.pay(providerOrderId, { status: "failed" });
    expect((await confirm(paymentId, razorpay.checkoutResult(declined))).status).toBe(200);
    expect((await readOrder(order.id)).payment?.status).toBe("requires_action");
  });

  it("leaves it to the webhook when Razorpay can't be reached", async () => {
    const { razorpay, openOrder, startCheckout, confirm, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    const paid = razorpay.pay(providerOrderId);
    razorpay.failNext("GET /payments/:id", 503);
    expect(problemSchema.parse((await confirm(paymentId, razorpay.checkoutResult(paid))).body).code).toBe(
      "service_unavailable",
    );
    expect((await webhook("payment.captured", paid.id)).outcome).toBe("fulfilled");
    expect((await readOrder(order.id)).status).toBe("fulfilled");
  });
});

describe("the scheduler's sweep", () => {
  it("settles a payment whose webhook and Checkout result were both lost, once", async () => {
    const { razorpay, openOrder, startCheckout, schedule, readOrder } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    razorpay.pay(providerOrderId);
    expect((await schedule()).swept).toBe(0);

    // The checkout has closed, and its webhook has had time to arrive.
    nowMs += 5 * MINUTE_MS + 2 * MINUTE_MS;
    expect((await schedule()).swept).toBe(1);
    expect((await readOrder(order.id)).status).toBe("fulfilled");
    expect((await schedule()).swept).toBe(0);
  });
});

describe("money that can't become tickets", () => {
  it("is refunded through Razorpay when it's paid after the hold ran out", async () => {
    const { razorpay, api, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    nowMs += 6 * MINUTE_MS;
    const late = razorpay.pay(providerOrderId);

    expect((await webhook("payment.captured", late.id)).outcome).toBe("refunded");
    expect(await commandsFor(paymentId)).toMatchObject([{ kind: "refund", providerPaymentId: late.id, doneAt: null }]);

    expect(await api.deliverDue()).toBe(1);
    expect(await readOrder(order.id)).toMatchObject({ status: "refunded", payment: { status: "refunded" } });
    expect(razorpay.payments.get(late.id)).toMatchObject({ status: "refunded", amount_refunded: late.amount });
    expect(await api.deliverDue()).toBe(0);
    expect(razorpay.refunds.size).toBe(1);
    expect((await webhook("refund.processed", late.id)).outcome).toBe("refund-confirmed");
  });

  it("is refunded when it pays a checkout the buyer gave up on and paid another way", async () => {
    const { razorpay, api, send, openOrder, startCheckout, webhook, readOrder } = setUp();
    const { order } = await openOrder();
    const abandoned = await startCheckout(order.id);
    await send("POST", `/api/payments/${abandoned.paymentId}/cancel`);
    const second = await startCheckout(order.id);
    expect((await webhook("payment.captured", razorpay.pay(second.providerOrderId).id)).outcome).toBe("fulfilled");

    const stray = razorpay.pay(abandoned.providerOrderId);
    expect((await webhook("payment.captured", stray.id)).outcome).toBe("refunded");
    const fulfilled = await readOrder(order.id);
    expect(fulfilled).toMatchObject({ status: "fulfilled", payment: { id: second.paymentId, status: "succeeded" } });
    await api.deliverDue();
    expect(razorpay.payments.get(stray.id)?.status).toBe("refunded");
  });

  it("is refunded when it's for the wrong amount, and the order can still be paid", async () => {
    const { razorpay, openOrder, startCheckout, webhook, readOrder, pay } = setUp();
    const { order } = await openOrder();
    const { providerOrderId } = await startCheckout(order.id);
    const providerOrder = razorpay.orders.get(providerOrderId);
    if (providerOrder) providerOrder.amount -= 100;

    expect((await webhook("payment.captured", razorpay.pay(providerOrderId).id)).outcome).toBe("refunded");
    expect((await readOrder(order.id)).status).toBe("pending");
    expect((await pay(order.id)).status).toBe(202);
  });

  it("is refunded again later if Razorpay fails, and only once if a reply is lost", async () => {
    let shouldLoseReply = false;
    const { razorpay, api, openOrder, startCheckout, webhook } = setUp({
      wrapClient: (client) => ({
        ...client,
        refundPayment: async (...args) => {
          const refund = await client.refundPayment(...args);
          if (shouldLoseReply) throw new RazorpayError("Razorpay POST /payments/:id/refund timed out.", null, true);
          return refund;
        },
      }),
    });
    const { order } = await openOrder();
    const { paymentId, providerOrderId } = await startCheckout(order.id);
    nowMs += 6 * MINUTE_MS;
    await webhook("payment.captured", razorpay.pay(providerOrderId).id);

    razorpay.failNext("POST /payments/:id/refund", 500);
    shouldLoseReply = true;
    expect(await api.deliverDue()).toBe(0);
    expect((await commandsFor(paymentId))[0]).toMatchObject({ attempts: 1, doneAt: null });
    expect(await api.deliverDue()).toBe(0);
    nowMs += 1_000;
    // This time the refund goes through, but its reply is lost.
    expect(await api.deliverDue()).toBe(0);
    expect(razorpay.refunds.size).toBe(1);
    nowMs += 2_000;
    // Asked again, Razorpay says it's refunded already: done, and not refunded twice.
    expect(await api.deliverDue()).toBe(1);
    expect(razorpay.refunds.size).toBe(1);
    expect((await commandsFor(paymentId))[0]?.doneAt).not.toBeNull();
  });
});
