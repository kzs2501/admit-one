// @vitest-environment node
/**
 * Razorpay's API client, against the in-memory fake: what it sends, how it reads the
 * replies, and how it fails — saying which call, never what was in it.
 */
import { describe, expect, it } from "vitest";
import { createRazorpayClient, RazorpayError } from "./client";
import { createFakeRazorpay } from "./testing/fake-razorpay";

const setUp = () => {
  const razorpay = createFakeRazorpay();
  return { razorpay, client: createRazorpayClient(razorpay.settings, { fetch: razorpay.fetch }) };
};

async function failureOf(promise: Promise<unknown>): Promise<RazorpayError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof RazorpayError)) throw new Error(`Expected a RazorpayError, got ${String(error)}`);
  return error;
}

describe("the Razorpay client", () => {
  it("creates an order in minor units, with its receipt and notes", async () => {
    const { razorpay, client } = setUp();
    const order = await client.createOrder({
      amountMinor: 118_000,
      currency: "INR",
      receipt: "pay_1",
      notes: { order_id: "ord_1" },
    });
    expect(order).toMatchObject({ amount: 118_000, currency: "INR", receipt: "pay_1", status: "created" });
    expect(razorpay.orders.get(order.id)?.notes).toEqual({ order_id: "ord_1" });
  });

  it("finds an order's payments, fetches one, captures it, and refunds it", async () => {
    const { razorpay, client } = setUp();
    const order = await client.createOrder({ amountMinor: 50_000, currency: "INR", receipt: "pay_2", notes: {} });
    expect(await client.orderPayments(order.id)).toEqual([]);

    const paid = razorpay.pay(order.id, { status: "authorized" });
    expect(await client.orderPayments(order.id)).toMatchObject([{ id: paid.id, status: "authorized" }]);
    expect(await client.capturePayment(paid.id, 50_000, "INR")).toMatchObject({ status: "captured", captured: true });
    expect(await client.fetchPayment(paid.id)).toMatchObject({ card: { last4: "1111" }, amount_refunded: 0 });

    const refund = await client.refundPayment(paid.id, { receipt: "cmd_1", notes: { reason: "late" } });
    expect(refund).toMatchObject({ payment_id: paid.id, amount: 50_000, status: "processed" });
    expect(await client.fetchPayment(paid.id)).toMatchObject({ amount_refunded: 50_000 });
    expect(razorpay.calls).toContain("POST /payments/:id/refund");
  });

  it("knows Checkout's result is Razorpay's by its signature, over both ids", async () => {
    const { razorpay, client } = setUp();
    const order = await client.createOrder({ amountMinor: 100, currency: "INR", receipt: "pay_3", notes: {} });
    const result = razorpay.checkoutResult(razorpay.pay(order.id));
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = result;
    expect(client.isCheckoutResult(orderId, paymentId, signature)).toBe(true);
    expect(client.isCheckoutResult(orderId, "pay_other", signature)).toBe(false);
    expect(client.isCheckoutResult(orderId, paymentId, signature.toUpperCase())).toBe(false);
    expect(client.isCheckoutResult(orderId, paymentId, "not-hex")).toBe(false);
  });

  it("is refused with the wrong key", async () => {
    const razorpay = createFakeRazorpay();
    const client = createRazorpayClient({ ...razorpay.settings, keySecret: "wrong" }, { fetch: razorpay.fetch });
    const error = await failureOf(client.fetchPayment("pay_x"));
    expect(error).toMatchObject({ status: 401, isRetryable: false });
  });

  it("names the call, not its ids, when Razorpay refuses it", async () => {
    const { client } = setUp();
    const error = await failureOf(client.fetchPayment("pay_secret123"));
    expect(error).toMatchObject({ status: 400, isRetryable: false });
    expect(error.message).toBe("Razorpay GET /payments/:id answered 400 (BAD_REQUEST_ERROR).");
  });

  it.each([500, 503, 429])("can try again after a %i", async (status) => {
    const { razorpay, client } = setUp();
    razorpay.failNext("POST /orders", status);
    const error = await failureOf(client.createOrder({ amountMinor: 1, currency: "INR", receipt: "r", notes: {} }));
    expect(error).toMatchObject({ status, isRetryable: true });
    // Only that one call failed.
    await expect(
      client.createOrder({ amountMinor: 1, currency: "INR", receipt: "r", notes: {} }),
    ).resolves.toBeTruthy();
  });

  it("can try again after the network fails, or Razorpay takes too long", async () => {
    const offline = createRazorpayClient(createFakeRazorpay().settings, {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect(await failureOf(offline.fetchPayment("pay_1"))).toMatchObject({
      message: "Razorpay GET /payments/:id couldn't connect.",
      isRetryable: true,
    });

    const slow = createRazorpayClient(createFakeRazorpay().settings, {
      timeoutMs: 20,
      fetch: (_, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    });
    expect(await failureOf(slow.fetchPayment("pay_1"))).toMatchObject({
      message: "Razorpay GET /payments/:id timed out.",
      isRetryable: true,
    });
  });

  it("refuses a reply it doesn't understand, naming the fields", async () => {
    const client = createRazorpayClient(createFakeRazorpay().settings, {
      fetch: () => Promise.resolve(Response.json({ id: "pay_1", amount: "a lot" })),
    });
    const error = await failureOf(client.fetchPayment("pay_1"));
    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("unexpected shape (order_id, amount, currency, status");
  });
});
