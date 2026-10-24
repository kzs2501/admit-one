/**
 * The simulated payment provider's signatures: how it signs a webhook, and how the
 * server checks one, the way real providers do (Stripe's scheme).
 *
 * The header is `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, under a secret
 * shared with the provider; while a secret is being rotated, it carries a `v1=` for
 * each, and either may match. Checking it:
 * - over the raw body, byte for byte, never a re-serialised parse;
 * - with a constant-time compare, so the time taken doesn't hint at the right digest;
 * - within five minutes of `t`, so a captured webhook can't be replayed later. Event ids
 *   are deduplicated as well, which is what stops a replay inside those five minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import * as z from "@/core/zod";
import { fail, ok, type Result } from "@/backend/domain/errors";
import { WEBHOOK_SIGNATURE_HEADER as SIGNATURE_HEADER } from "@/contract/routes";

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

const webhookBase = {
  id: z.string().min(1),
  /** When the provider sent it, in unix seconds. */
  created: z.number().int(),
};

/**
 * What the provider says happened, once the signature checks out. A failure is one the
 * provider reports later, after the buyer has gone to approve it: a UPI request declined.
 */
export const providerWebhookSchema = z.discriminatedUnion("type", [
  z.object({ ...webhookBase, type: z.literal("payment.succeeded"), data: z.object({ paymentId: z.string().min(1) }) }),
  z.object({
    ...webhookBase,
    type: z.literal("payment.failed"),
    data: z.object({ paymentId: z.string().min(1), failureCode: z.literal("upi_declined") }),
  }),
]);
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
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([name]) => name === "t")?.[1];
  const signatures = parts.filter(([name]) => name === "v1").map(([, value]) => value ?? "");
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    signatures.length === 0 ||
    !signatures.every((signature) => /^[0-9a-f]{64}$/.test(signature))
  ) {
    return invalid(`The ${SIGNATURE_HEADER} header isn’t in the form t=…,v1=….`);
  }
  if (Math.abs(nowMs - Number(timestamp) * 1000) > SIGNATURE_TOLERANCE_MS) {
    return invalid("The signature is more than five minutes old: a replay, or a clock far out.");
  }
  const expected = Buffer.from(hmac(secret, timestamp, rawBody), "hex");
  // Every signature is compared, so the time taken doesn't say which one matched.
  const matches = signatures.map((signature) => timingSafeEqual(expected, Buffer.from(signature, "hex")));
  if (!matches.includes(true)) {
    return invalid("The signature doesn’t match the body: it was signed with another secret, or changed since.");
  }
  try {
    const parsed = providerWebhookSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? ok(parsed.data) : invalid("The signed body isn’t a webhook this server understands.");
  } catch {
    return invalid("The signed body isn’t JSON.");
  }
}
