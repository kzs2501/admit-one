/**
 * Razorpay's REST API, as much of it as the server uses: orders, the payments made
 * against them, capture, and refunds. Every reply is parsed at the boundary, as the
 * browser parses ours. Errors say which call failed and how, never what was in it:
 * the buyer's details and the keys stay out of the logs (`postgres/db.ts`
 * describeError has the same rule).
 */
import * as z from "@/core/zod";
import type { RazorpaySettings } from "./settings";

const minorUnitsSchema = z.number().int().nonnegative();

/** Razorpay's states for a payment. `authorized` is money held at the bank, not yet taken. */
export const RAZORPAY_PAYMENT_STATUSES = ["created", "authorized", "captured", "refunded", "failed"] as const;

export const razorpayOrderSchema = z.object({
  id: z.string(),
  amount: minorUnitsSchema,
  currency: z.string(),
  receipt: z.string().nullable(),
  status: z.string(),
});
export type RazorpayOrder = z.infer<typeof razorpayOrderSchema>;

export const razorpayPaymentSchema = z.object({
  id: z.string(),
  order_id: z.string().nullable(),
  amount: minorUnitsSchema,
  currency: z.string(),
  status: z.enum(RAZORPAY_PAYMENT_STATUSES),
  /** card, upi, netbanking, wallet, emi… */
  method: z.string(),
  amount_refunded: minorUnitsSchema,
  captured: z.boolean(),
  card: z.object({ last4: z.string() }).nullish(),
  error_code: z.string().nullish(),
  created_at: z.number().int(),
});
export type RazorpayPayment = z.infer<typeof razorpayPaymentSchema>;

const paymentCollectionSchema = z.object({ items: z.array(razorpayPaymentSchema) });

export const razorpayRefundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: minorUnitsSchema,
  status: z.string(),
});
export type RazorpayRefund = z.infer<typeof razorpayRefundSchema>;

const errorReplySchema = z.object({ error: z.object({ code: z.string().optional() }).optional() });

/** A call that failed. `isRetryable` when trying again later could work: the network, a timeout, Razorpay's own trouble. */
export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export interface RazorpayClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export const RAZORPAY_TIMEOUT_MS = 10_000;

export function createRazorpayClient(
  { keyId, keySecret, apiUrl }: Pick<RazorpaySettings, "keyId" | "keySecret" | "apiUrl">,
  { fetch = globalThis.fetch, timeoutMs = RAZORPAY_TIMEOUT_MS }: RazorpayClientOptions = {},
) {
  const authorization = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  /** `route` names the call in errors without its ids: `GET /payments/:id`. */
  async function call<T>(schema: z.ZodType<T>, route: string, path: string, body?: unknown): Promise<T> {
    const [method = "GET"] = route.split(" ");
    let response: Response;
    try {
      response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "couldn't connect";
      throw new RazorpayError(`Razorpay ${route} ${reason}.`, null, true);
    }
    const reply: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = errorReplySchema.safeParse(reply).data?.error?.code ?? "no error code";
      const isRetryable = response.status >= 500 || response.status === 429;
      throw new RazorpayError(
        `Razorpay ${route} answered ${String(response.status)} (${code}).`,
        response.status,
        isRetryable,
      );
    }
    const parsed = schema.safeParse(reply);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
      throw new RazorpayError(`Razorpay ${route} answered in an unexpected shape (${fields}).`, response.status, false);
    }
    return parsed.data;
  }

  const id = (value: string) => encodeURIComponent(value);

  return {
    keyId,

    /** An order to pay against: Checkout opens on it, and its payments are looked up by it. */
    createOrder: (input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }) =>
      call(razorpayOrderSchema, "POST /orders", "/orders", {
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      }),

    /** Every attempt to pay an order, failed ones too. */
    orderPayments: async (orderId: string) =>
      (await call(paymentCollectionSchema, "GET /orders/:id/payments", `/orders/${id(orderId)}/payments`)).items,

    fetchPayment: (paymentId: string) => call(razorpayPaymentSchema, "GET /payments/:id", `/payments/${id(paymentId)}`),

    /** Take money the bank has authorised. Accounts on automatic capture never need it. */
    capturePayment: (paymentId: string, amountMinor: number, currency: string) =>
      call(razorpayPaymentSchema, "POST /payments/:id/capture", `/payments/${id(paymentId)}/capture`, {
        amount: amountMinor,
        currency,
      }),

    /** Give it all back. */
    refundPayment: (paymentId: string, input: { receipt: string; notes: Record<string, string> }) =>
      call(razorpayRefundSchema, "POST /payments/:id/refund", `/payments/${id(paymentId)}/refund`, {
        receipt: input.receipt,
        notes: input.notes,
      }),
  };
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>;
