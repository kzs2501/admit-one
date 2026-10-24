/**
 * Webhooks on the server. Receiving one is deduplicated by its event id, with an insert
 * that does nothing on conflict, in the same transaction as its effect: a duplicate
 * can't fulfil an order twice, and a crash can't leave an event marked done but not
 * done. Its effect is the sandbox's own handling, run on the payment's hold's records.
 *
 * Sending them is the simulated provider's part: events it queued are signed and sent
 * once due, through the server's own webhook handler, so every webhook is checked the
 * way a real provider's would be. A sender takes due events on a short lease, so two
 * senders never send the same one; one that fails is tried again later, so it can
 * never hold up the rest.
 */
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import type { Result } from "@/backend/domain/errors";
import { fail, ok } from "@/backend/domain/errors";
import type { OutboxItem } from "@/backend/domain/state";
import { deliverDue } from "@/backend/domain/webhooks";
import { API_ROUTES, WEBHOOK_SIGNATURE_HEADER } from "@/contract/routes";
import { describeError, withRetries, type Database } from "./db";
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
    // When the provider confirmed it, which is what the domain judges the hold by.
    deliverAtMs: event.created * 1000,
    paymentId: event.data.paymentId,
  };
  return event.type === "payment.succeeded"
    ? { ...common, type: "payment.succeeded" }
    : { ...common, type: "payment.failed", failureCode: event.data.failureCode };
}

/**
 * Act on a verified webhook, once. An event about a payment this server doesn't know
 * (yet: a provider can be quicker than the commit that records the payment) isn't
 * recorded as handled, so when it's sent again it's acted on.
 */
export async function receiveWebhook(db: Database, deps: ServerDeps, event: ProviderWebhook): Promise<WebhookOutcome> {
  try {
    return await withRetries(() =>
      db.transaction(async (tx) => {
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
        // Undo the dedupe row too: nothing was done, so nothing is marked done.
        if (!processed) tx.rollback();
        return "processed";
      }),
    );
  } catch (error) {
    if (error instanceof TransactionRollbackError) return "unknown-payment";
    throw error;
  }
}

/** The webhook endpoint's work: check the signature over the raw body, then act on it once. */
export function createWebhookReceiver(db: Database, deps: ServerDeps, secret: string) {
  return {
    async receive(rawBody: string, signature: string | null): Promise<Result<WebhookOutcome>> {
      const verified = verifyWebhook(secret, rawBody, signature, deps.now());
      if (!verified.ok) return verified;
      const outcome = await receiveWebhook(db, deps, verified.value);
      // Not acknowledged, so the provider sends it again later.
      if (outcome === "unknown-payment") {
        return fail({ code: "not_found", detail: "No payment with that id yet. Send the event again later." });
      }
      return ok(outcome);
    },
  };
}

export type WebhookReceiver = ReturnType<typeof createWebhookReceiver>;

/** A failed delivery is tried again after 1 s, then 2 s, 4 s… at most a minute apart. */
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 60_000;
/** After this many failures, an event is left for someone to look at, as providers do. */
export const MAX_DELIVERY_ATTEMPTS = 10;
/** How long a sender has the events it took to itself. */
const LEASE_MS = 30_000;
const BATCH = 20;

const retryDelayMs = (attempts: number) => Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempts);

type ProviderEventRow = typeof providerEvents.$inferSelect;
type Send = (request: Request) => Promise<Response>;

/** Send one event; the reason it failed, or null if the endpoint took it. */
async function deliver(event: ProviderEventRow, secret: string, send: Send, origin: string, nowMs: number) {
  const body = JSON.stringify({
    id: event.eventId,
    type: event.type,
    // When it happened: the provider confirmed it at the moment it fell due.
    created: Math.floor(event.deliverAt.getTime() / 1000),
    data: { paymentId: event.paymentId, ...(event.failureCode ? { failureCode: event.failureCode } : {}) },
  });
  try {
    const response = await send(
      new Request(new URL(API_ROUTES.providerWebhook, origin), {
        method: "POST",
        headers: { "Content-Type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, body, nowMs) },
        body,
      }),
    );
    return response.ok ? null : `The endpoint answered ${String(response.status)}.`;
  } catch (error) {
    // Logged, and kept on the row: what failed, never the data that was in it.
    return describeError(error);
  }
}

/**
 * The simulated provider sends what's due: each event signed now, as its webhook, to the
 * server's webhook endpoint (`send` is the server's own request handler). An event is
 * marked delivered once the endpoint accepts it; until then it's sent again later, so
 * delivery is at least once, as a real provider's is. Never throws for one event's
 * sake. Returns how many it delivered.
 */
export async function sendDueWebhooks(
  db: Database,
  deps: ServerDeps,
  { secret, send, origin }: { secret: string; send: Send; origin: string },
): Promise<number> {
  const now = new Date(deps.now());
  // Take the due events on a lease, skipping any another sender holds.
  const due = db
    .select({ deliveryId: providerEvents.deliveryId })
    .from(providerEvents)
    .where(
      and(
        isNull(providerEvents.deliveredAt),
        // Due: never tried and past its time, or past the time set for its next try.
        or(
          and(isNull(providerEvents.nextAttemptAt), lte(providerEvents.deliverAt, now)),
          lte(providerEvents.nextAttemptAt, now),
        ),
        lt(providerEvents.attempts, MAX_DELIVERY_ATTEMPTS),
        or(isNull(providerEvents.leaseUntil), lte(providerEvents.leaseUntil, now)),
      ),
    )
    .orderBy(asc(providerEvents.deliverAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  const taken = await db
    .update(providerEvents)
    .set({ leaseUntil: new Date(deps.now() + LEASE_MS) })
    .where(inArray(providerEvents.deliveryId, due))
    .returning();

  let delivered = 0;
  for (const event of taken.sort((left, right) => left.deliverAt.getTime() - right.deliverAt.getTime())) {
    const failure = await deliver(event, secret, send, origin, deps.now());
    if (failure === null) {
      delivered += 1;
      await db
        .update(providerEvents)
        .set({ deliveredAt: now, leaseUntil: null })
        .where(eq(providerEvents.deliveryId, event.deliveryId));
    } else {
      console.error(`[webhooks] ${event.eventId}, attempt ${String(event.attempts + 1)}, failed: ${failure}`);
      await db
        .update(providerEvents)
        .set({
          attempts: event.attempts + 1,
          lastError: failure.slice(0, 500),
          nextAttemptAt: new Date(deps.now() + retryDelayMs(event.attempts)),
          leaseUntil: null,
        })
        .where(eq(providerEvents.deliveryId, event.deliveryId));
    }
  }
  return delivered;
}
