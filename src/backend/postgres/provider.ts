/**
 * The simulated payment provider's signatures: how it signs a webhook, and how the
 * server checks one, the way real providers do (Stripe's scheme).
 *
 * The header is `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, under a secret
 * shared with the provider. Checking it:
 * - over the raw body, byte for byte, never a re-serialised parse;
 * - with a constant-time compare, so the time taken doesn't hint at the right digest;
 * - within five minutes of `t`, so a captured webhook can't be replayed later. Event ids
 *   are deduplicated as well, which is what stops a replay inside those five minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "@/core/zod";
import { fail, ok, type Result } from "@/backend/domain/errors";
import { PAYMENT_FAILURE_CODES } from "@/core/statuses";
import { WEBHOOK_SIGNATURE_HEADER as SIGNATURE_HEADER } from "@/contract/routes";

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

/** What the provider says happened, once the signature checks out. */
export const providerWebhookSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  /** When the provider sent it, in unix seconds. */
  created: z.number().int(),
  data: z.object({ paymentId: z.string().min(1), failureCode: z.enum(PAYMENT_FAILURE_CODES).optional() }),
});
export type ProviderWebhook = z.infer<typeof providerWebhookSchema>;

const hmac = (secret: string, timestamp: string, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** The provider's side: sign a body, at a moment. */
export function signWebhook(secret: string, body: string, atMs: number) {
  const timestamp = String(Math.floor(atMs / 1000));
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

const invalid = (detail: string) => fail({ code: "invalid_signature", detail });

/** The server's side: the webhook, if it's signed by the provider recently enough, and unchanged since. */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null,
  nowMs: number,
): Result<ProviderWebhook> {
  if (!header) return invalid(`The ${SIGNATURE_HEADER} header is missing.`);
  const parts = new Map(header.split(",").map((part) => part.split("=", 2) as [string, string | undefined]));
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) {
    return invalid(`The ${SIGNATURE_HEADER} header isn’t in the form t=…,v1=….`);
  }
  if (Math.abs(nowMs - Number(timestamp) * 1000) > SIGNATURE_TOLERANCE_MS) {
    return invalid("The signature is more than five minutes old: a replay, or a clock far out.");
  }
  const expected = Buffer.from(hmac(secret, timestamp, rawBody), "hex");
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    return invalid("The signature doesn’t match the body: it was signed with another secret, or changed since.");
  }
  try {
    const parsed = providerWebhookSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? ok(parsed.data) : invalid("The signed body isn’t a webhook this server understands.");
  } catch {
    return invalid("The signed body isn’t JSON.");
  }
}
