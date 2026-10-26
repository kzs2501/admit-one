/**
 * A stand-in for Razorpay's test mode, in memory, for tests: the API calls the server
 * makes (as a `fetch`), what a buyer does in Checkout (`pay`), and the signed things
 * Razorpay sends back — Checkout's result and webhooks. Only tests import this.
 */
import type { RazorpayPayment, RazorpayRefund } from "../client";
import type { RazorpaySettings } from "../settings";
import { checkoutPayload, RAZORPAY_EVENT_ID_HEADER, RAZORPAY_SIGNATURE_HEADER, razorpaySignature } from "../signatures";

interface FakeOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes: Record<string, string>;
}

type FakeRefund = RazorpayRefund & { receipt: string | null };

export type RazorpayEvent = "payment.authorized" | "payment.captured" | "payment.failed" | "refund.processed";

const error = (status: number, description: string) =>
  Response.json({ error: { code: "BAD_REQUEST_ERROR", description } }, { status });

// Shared by every fake, as Razorpay's ids are unique across its accounts: tests that share
// a database never see two payments with one id.
let sequence = 0;

export function createFakeRazorpay({ now = () => Date.now() }: { now?: () => number } = {}) {
  const settings: RazorpaySettings = {
    keyId: "rzp_test_fake0000000000",
    keySecret: "fake_key_secret",
    webhookSecret: "fake_webhook_secret",
    apiUrl: "https://razorpay.fake/v1",
  };
  const orders = new Map<string, FakeOrder>();
  const payments = new Map<string, RazorpayPayment>();
  const refunds = new Map<string, FakeRefund>();
  /** Every call made, as its route: `POST /payments/:id/refund`. */
  const calls: string[] = [];
  const failures: { route: string; status: number }[] = [];
  const newId = (prefix: string) => `${prefix}_fake${String(++sequence).padStart(8, "0")}`;
  const unixNow = () => Math.floor(now() / 1000);
  const authorization = `Basic ${btoa(`${settings.keyId}:${settings.keySecret}`)}`;

  function handle(method: string, path: string, body: Record<string, unknown>): Response {
    const [, resource = "", id = "", action = ""] = path.split("/");
    if (method === "POST" && resource === "orders" && !id) {
      const order: FakeOrder = {
        id: newId("order"),
        amount: Number(body["amount"]),
        currency: String(body["currency"]),
        receipt: typeof body["receipt"] === "string" ? body["receipt"] : null,
        status: "created",
        notes: (body["notes"] ?? {}) as Record<string, string>,
      };
      orders.set(order.id, order);
      return Response.json({ entity: "order", amount_paid: 0, attempts: 0, ...order, created_at: unixNow() });
    }
    if (method === "GET" && resource === "orders" && action === "payments") {
      if (!orders.has(id)) return error(400, "The id provided does not exist");
      const items = [...payments.values()].filter((payment) => payment.order_id === id);
      return Response.json({ entity: "collection", count: items.length, items });
    }
    const payment = resource === "payments" ? payments.get(id) : undefined;
    if (resource === "payments" && !payment) return error(400, "The id provided does not exist");
    if (payment && method === "GET" && !action) return Response.json(payment);
    if (payment && method === "POST" && action === "capture") {
      if (payment.status !== "authorized") return error(400, "This payment has already been captured");
      Object.assign(payment, { status: "captured", captured: true });
      return Response.json(payment);
    }
    if (payment && method === "POST" && action === "refund") {
      if (payment.status !== "captured" || payment.amount_refunded > 0) {
        return error(400, "The payment has been fully refunded already");
      }
      const refund: FakeRefund = {
        id: newId("rfnd"),
        payment_id: payment.id,
        amount: payment.amount,
        status: "processed",
        receipt: typeof body["receipt"] === "string" ? body["receipt"] : null,
      };
      refunds.set(refund.id, refund);
      Object.assign(payment, { status: "refunded", amount_refunded: payment.amount });
      return Response.json({ entity: "refund", ...refund });
    }
    return error(404, "The requested URL was not found on the server.");
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/v1/, "");
    const route = `${request.method} ${path.replace(/\/(order|pay|rfnd)_[A-Za-z0-9]+/g, "/:id")}`;
    calls.push(route);
    if (request.headers.get("Authorization") !== authorization) return error(401, "The api key provided is invalid");
    const failure = failures.findIndex((candidate) => candidate.route === route);
    if (failure !== -1) {
      const [failed] = failures.splice(failure, 1);
      return Response.json({ error: { code: "SERVER_ERROR" } }, { status: failed?.status ?? 500 });
    }
    const text = await request.text();
    return handle(request.method, path, text ? (JSON.parse(text) as Record<string, unknown>) : {});
  };

  function paymentOf(paymentId: string): RazorpayPayment {
    const payment = payments.get(paymentId);
    if (!payment) throw new Error(`The fake has no payment ${paymentId}.`);
    return payment;
  }

  return {
    settings,
    fetch,
    calls,
    orders,
    payments,
    refunds,

    /** The buyer pays in Checkout: by card unless told otherwise, captured unless told otherwise. */
    pay(
      orderId: string,
      { status = "captured", method = "card" }: { status?: "authorized" | "captured" | "failed"; method?: string } = {},
    ): RazorpayPayment {
      const order = orders.get(orderId);
      if (!order) throw new Error(`The fake has no order ${orderId}.`);
      const payment: RazorpayPayment = {
        id: newId("pay"),
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        status,
        method,
        amount_refunded: 0,
        captured: status === "captured",
        card: method === "card" ? { last4: "1111" } : null,
        error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null,
        created_at: unixNow(),
      };
      payments.set(payment.id, payment);
      if (status === "captured") order.status = "paid";
      return payment;
    },

    /** What Checkout's success handler is given, signed with the key secret. */
    checkoutResult: (payment: RazorpayPayment) => ({
      razorpay_order_id: payment.order_id ?? "",
      razorpay_payment_id: payment.id,
      razorpay_signature: razorpaySignature(settings.keySecret, checkoutPayload(payment.order_id ?? "", payment.id)),
    }),

    /** A webhook as Razorpay would send it: its raw body and headers, signed with the webhook secret. */
    webhook(event: RazorpayEvent, paymentId: string, { eventId = newId("evt") }: { eventId?: string } = {}) {
      const payment = paymentOf(paymentId);
      const refund = [...refunds.values()].find((candidate) => candidate.payment_id === paymentId);
      const payload =
        event === "refund.processed" && refund
          ? { refund: { entity: { entity: "refund", ...refund } }, payment: { entity: payment } }
          : { payment: { entity: payment } };
      const body = JSON.stringify({
        entity: "event",
        account_id: "acc_fake",
        event,
        contains: Object.keys(payload),
        payload,
        created_at: unixNow(),
      });
      return {
        body,
        headers: {
          "Content-Type": "application/json",
          [RAZORPAY_SIGNATURE_HEADER]: razorpaySignature(settings.webhookSecret, body),
          [RAZORPAY_EVENT_ID_HEADER]: eventId,
        },
      };
    },

    /** The next call to `route` fails with `status`, as Razorpay does when it's in trouble. */
    failNext(route: string, status: number) {
      failures.push({ route, status });
    },
  };
}

export type FakeRazorpay = ReturnType<typeof createFakeRazorpay>;
