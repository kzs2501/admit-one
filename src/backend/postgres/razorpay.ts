/**
 * Razorpay on the server: its webhooks received, its payments settled from whatever
 * reports them, and what settling decides to ask Razorpay for (a capture, a refund)
 * sent once that decision has committed.
 *
 * A webhook is acted on once: its event id is recorded in the transaction that acts
 * on it, as the simulated provider's are (`webhooks.ts`). Razorpay's signature carries
 * no timestamp, so a replayed webhook can't be refused for its age; it finds its event
 * id already recorded, or its payment already settled, and changes nothing.
 *
 * Commands are an outbox: written with the change, sent after, retried until they
 * work. Each first asks Razorpay how the payment stands, so one that went through but
 * wasn't marked done is never sent twice — and a refund is never given up on.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { fail, ok, type Result } from "@/backend/domain/errors";
import { settleObservedPayment, type ObservedPayment, type SettleOutcome } from "@/backend/domain/provider-payments";
import { RazorpayError, type RazorpayClient, type RazorpayPayment } from "@/backend/razorpay/client";
import { observedPaymentOf, razorpayEventSchema, type RazorpayEvent } from "@/backend/razorpay/events";
import { isRazorpaySignature } from "@/backend/razorpay/signatures";
import { describeError, withRetries, type Database } from "./db";
import type { ServerDeps } from "./records";
import { payments, providerCommands, webhookEvents } from "./schema";
import { withHoldIn, type Transaction } from "./unit-of-work";

export type RazorpayWebhookOutcome = SettleOutcome | "duplicate" | "not-ours" | "ignored" | "refund-confirmed";

/** Settle a payment from what Razorpay reports, in `tx`: the change and the commands it needs commit together. */
async function settleIn(
  tx: Transaction,
  deps: ServerDeps,
  providerOrderId: string,
  observed: ObservedPayment,
): Promise<SettleOutcome | null> {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.providerOrderId, providerOrderId));
  if (!row) return null;
  const settlement = await withHoldIn(tx, deps, { paymentId: row.id }, (context) =>
    settleObservedPayment(context, row.id, observed),
  );
  if (!settlement) return null;
  if (settlement.commands.length > 0) {
    await tx
      .insert(providerCommands)
      .values(
        settlement.commands.map((command) => ({ id: deps.newId("cmd"), ...command, createdAt: new Date(deps.now()) })),
      )
      .onConflictDoNothing();
  }
  return settlement.outcome;
}

/** Settle from a payment fetched from Razorpay: Checkout's result, a capture, a sweep. Null if it isn't ours, or nothing's paid. */
export function settleRazorpayPayment(
  db: Database,
  deps: ServerDeps,
  payment: RazorpayPayment,
): Promise<SettleOutcome | null> {
  const observed = observedPaymentOf(payment);
  const providerOrderId = payment.order_id;
  if (!observed || providerOrderId === null) return Promise.resolve(null);
  return withRetries(() => db.transaction((tx) => settleIn(tx, deps, providerOrderId, observed)));
}

async function actOn(tx: Transaction, deps: ServerDeps, event: RazorpayEvent): Promise<RazorpayWebhookOutcome> {
  const payment = event.payload.payment?.entity;
  switch (event.event) {
    case "payment.authorized":
    case "payment.captured":
    case "payment.failed": {
      const observed = payment ? observedPaymentOf(payment) : null;
      if (!payment?.order_id || !observed) return "ignored";
      return (await settleIn(tx, deps, payment.order_id, observed)) ?? "not-ours";
    }
    case "refund.processed":
      // The refund was ours to ask for, and the payment says so already.
      return "refund-confirmed";
    default:
      return "ignored";
  }
}

/** The Razorpay webhook endpoint's work: check the signature over the raw body, then act on the event once. */
export function createRazorpayWebhookReceiver(db: Database, deps: ServerDeps, webhookSecret: string) {
  return {
    async receive(
      rawBody: string,
      signature: string | null,
      eventId: string | null,
    ): Promise<Result<RazorpayWebhookOutcome>> {
      if (signature === null || !isRazorpaySignature(webhookSecret, rawBody, signature)) {
        return fail({ code: "invalid_signature", detail: "The webhook’s signature doesn’t match its body." });
      }
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        json = null;
      }
      const parsed = razorpayEventSchema.safeParse(json);
      if (!parsed.success || !eventId) {
        return fail({ code: "invalid_request", detail: "That isn’t a webhook Razorpay sends." });
      }
      const event = parsed.data;
      const outcome = await withRetries(() =>
        db.transaction(async (tx) => {
          const [first] = await tx
            .insert(webhookEvents)
            .values({ eventId: `razorpay:${eventId}`, type: event.event, receivedAt: new Date(deps.now()) })
            .onConflictDoNothing()
            .returning({ eventId: webhookEvents.eventId });
          return first ? actOn(tx, deps, event) : ("duplicate" as const);
        }),
      );
      return ok(outcome);
    },
  };
}

export type RazorpayWebhookReceiver = ReturnType<typeof createRazorpayWebhookReceiver>;

/** A failed command is tried again after 1 s, then 2 s, 4 s… at most an hour apart, and never given up on. */
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 60 * 60_000;
const LEASE_MS = 30_000;
const BATCH = 20;

const retryDelayMs = (attempts: number) => Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempts);

type CommandRow = typeof providerCommands.$inferSelect;

/**
 * Ask Razorpay for what the command says, unless it's already so. Returns the payment,
 * once captured, for a capture: it settles at once, without waiting for the webhook.
 */
async function run(client: RazorpayClient, command: CommandRow): Promise<RazorpayPayment | null> {
  const payment = await client.fetchPayment(command.providerPaymentId);
  if (command.kind === "capture") {
    if (payment.status !== "authorized") return payment.status === "captured" ? payment : null;
    return client.capturePayment(command.providerPaymentId, command.amountMinor, command.currency);
  }
  // Refunded already, by this command before it was marked done, or by hand in Razorpay's dashboard.
  if (payment.amount_refunded > 0 || payment.status !== "captured") return null;
  await client.refundPayment(command.providerPaymentId, {
    receipt: command.id,
    notes: { payment_id: command.paymentId },
  });
  return null;
}

/** Send the commands that are due. Never throws for one command's sake. Returns how many went through. */
export async function sendDueCommands(db: Database, deps: ServerDeps, client: RazorpayClient): Promise<number> {
  const now = new Date(deps.now());
  const due = db
    .select({ id: providerCommands.id })
    .from(providerCommands)
    .where(
      and(
        isNull(providerCommands.doneAt),
        or(isNull(providerCommands.nextAttemptAt), lte(providerCommands.nextAttemptAt, now)),
        or(isNull(providerCommands.leaseUntil), lte(providerCommands.leaseUntil, now)),
      ),
    )
    .orderBy(asc(providerCommands.createdAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  const taken = await db
    .update(providerCommands)
    .set({ leaseUntil: new Date(deps.now() + LEASE_MS) })
    .where(inArray(providerCommands.id, due))
    .returning();

  let sent = 0;
  for (const command of taken.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())) {
    try {
      const captured = await run(client, command);
      await db
        .update(providerCommands)
        .set({ doneAt: new Date(deps.now()), leaseUntil: null, lastError: null })
        .where(eq(providerCommands.id, command.id));
      sent += 1;
      if (captured) await settleRazorpayPayment(db, deps, captured);
    } catch (error) {
      // Logged, and kept on the row, in one line: which call failed, never what was in it.
      const failure =
        error instanceof RazorpayError ? error.message : (describeError(error).split("\n")[0] ?? "It failed.");
      console.error(`[razorpay] ${command.kind} ${command.id}, attempt ${String(command.attempts + 1)}: ${failure}`);
      await db
        .update(providerCommands)
        .set({
          attempts: command.attempts + 1,
          lastError: failure.slice(0, 500),
          nextAttemptAt: new Date(deps.now() + retryDelayMs(command.attempts)),
          leaseUntil: null,
        })
        .where(eq(providerCommands.id, command.id));
    }
  }
  return sent;
}

/** A closed checkout is worth asking Razorpay about for as long as Razorpay retries its webhooks. */
const SWEEP_WINDOW_MS = 24 * 60 * 60_000;
/** A closed checkout's webhook gets this long to arrive before Razorpay is asked. */
const SWEEP_GRACE_MS = 2 * 60_000;

/**
 * The scheduler's sweep: ask Razorpay about checkouts that closed without a payment
 * reaching us, in case one was made and both its webhook and Checkout's result were
 * lost (a tab closed at the wrong moment, the endpoint down all day). At most a batch
 * a run, newest first. Returns how many payments it settled.
 */
export async function sweepClosedCheckouts(db: Database, deps: ServerDeps, client: RazorpayClient): Promise<number> {
  const nowMs = deps.now();
  const closed = await db
    .select({ providerOrderId: payments.providerOrderId })
    .from(payments)
    .where(
      and(
        eq(payments.method, "razorpay"),
        isNull(payments.providerPaymentId),
        gt(payments.checkoutExpiresAt, new Date(nowMs - SWEEP_WINDOW_MS)),
        lte(payments.checkoutExpiresAt, new Date(nowMs - SWEEP_GRACE_MS)),
      ),
    )
    .orderBy(desc(payments.checkoutExpiresAt))
    .limit(BATCH);

  let settledCount = 0;
  for (const { providerOrderId } of closed) {
    if (providerOrderId === null) continue;
    try {
      for (const paid of await client.orderPayments(providerOrderId)) {
        const outcome = await settleRazorpayPayment(db, deps, paid);
        if (outcome === "fulfilled" || outcome === "refunded" || outcome === "capturing") settledCount += 1;
      }
    } catch (error) {
      const failure =
        error instanceof RazorpayError ? error.message : (describeError(error).split("\n")[0] ?? "It failed.");
      console.error(`[razorpay] Couldn't check a closed checkout: ${failure}`);
    }
  }
  return settledCount;
}
