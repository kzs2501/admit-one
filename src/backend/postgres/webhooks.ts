/**
 * Webhooks on the server. Receiving one is deduplicated by its event id, with an insert
 * that does nothing on conflict, in the same transaction as its effect: a duplicate
 * can't fulfil an order twice, and a crash can't leave an event marked done but not
 * done. Its effect is the sandbox's own handling, run on the payment's hold's records.
 *
 * Sending them is the simulated provider's part: events it queued are signed and sent
 * once due, through the server's own webhook handler, so every webhook is checked the
 * way a real provider's would be.
 */
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { Result } from "@/backend/domain/errors";
import { ok } from "@/backend/domain/errors";
import type { OutboxItem } from "@/backend/domain/state";
import { deliverDue } from "@/backend/domain/webhooks";
import { API_ROUTES, WEBHOOK_SIGNATURE_HEADER } from "@/contract/routes";
import type { Database } from "./db";
import { signWebhook, verifyWebhook, type ProviderWebhook } from "./provider";
import type { ServerDeps } from "./records";
import { providerEvents, webhookEvents } from "./schema";
import { withHoldIn } from "./unit-of-work";

export type WebhookOutcome = "processed" | "duplicate" | "unknown-payment";

/** The provider's event as the sandbox's outbox holds it, due now. */
function outboxItemOf(event: ProviderWebhook, deps: ServerDeps): OutboxItem {
  const common = {
    deliveryId: deps.newId("dlv"),
    eventId: event.id,
    enqueuedAtMs: event.created * 1000,
    deliverAtMs: deps.now(),
    paymentId: event.data.paymentId,
  };
  return event.type === "payment.succeeded"
    ? { ...common, type: "payment.succeeded" }
    : { ...common, type: "payment.failed", failureCode: "upi_declined" };
}

/** Act on a verified webhook, once. */
export function receiveWebhook(db: Database, deps: ServerDeps, event: ProviderWebhook): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const [first] = await tx
      .insert(webhookEvents)
      .values({ eventId: event.id, type: event.type, receivedAt: new Date(deps.now()) })
      .onConflictDoNothing()
      .returning({ eventId: webhookEvents.eventId });
    if (!first) return "duplicate";
    const processed = await withHoldIn(tx, deps, { paymentId: event.data.paymentId }, (context) => {
      context.state.outbox.push(outboxItemOf(event, deps));
      deliverDue(context);
      return "processed" as const;
    });
    return processed ?? "unknown-payment";
  });
}

/** The webhook endpoint's work: check the signature over the raw body, then act on it once. */
export function createWebhookReceiver(db: Database, deps: ServerDeps, secret: string) {
  return {
    async receive(rawBody: string, signature: string | null): Promise<Result<WebhookOutcome>> {
      const verified = verifyWebhook(secret, rawBody, signature, deps.now());
      return verified.ok ? ok(await receiveWebhook(db, deps, verified.value)) : verified;
    },
  };
}

export type WebhookReceiver = ReturnType<typeof createWebhookReceiver>;

/**
 * The simulated provider sends what's due: each event signed now, as its webhook, to the
 * server's webhook endpoint (`send` is the server's own request handler). An event is
 * marked delivered once the endpoint accepts it; until then it's sent again next time,
 * so delivery is at least once, as a real provider's is.
 */
export async function sendDueWebhooks(
  db: Database,
  deps: ServerDeps,
  { secret, send, origin }: { secret: string; send: (request: Request) => Promise<Response>; origin: string },
): Promise<number> {
  const now = new Date(deps.now());
  const due = await db
    .select()
    .from(providerEvents)
    .where(and(isNull(providerEvents.deliveredAt), lte(providerEvents.deliverAt, now)))
    .orderBy(asc(providerEvents.deliverAt))
    .limit(20);
  for (const event of due) {
    const body = JSON.stringify({
      id: event.eventId,
      type: event.type,
      created: Math.floor(event.enqueuedAt.getTime() / 1000),
      data: { paymentId: event.paymentId, ...(event.failureCode ? { failureCode: event.failureCode } : {}) },
    });
    const response = await send(
      new Request(new URL(API_ROUTES.providerWebhook, origin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, body, deps.now()),
        },
        body,
      }),
    );
    if (response.ok) {
      await db.update(providerEvents).set({ deliveredAt: now }).where(eq(providerEvents.deliveryId, event.deliveryId));
    }
  }
  return due.length;
}
