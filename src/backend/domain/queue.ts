/**
 * The waiting room: in a high-demand sale, everyone joins a line before they can
 * reserve, and the line lets people in a batch at a time (first in, first out, as
 * Cloudflare's and Queue-it's do).
 *
 * Nothing moves the line on a timer. A place is a pure function of when it was taken
 * and what time it is — like a hold's expiry — so it can't drift, a reload resumes it
 * exactly, and reads never write. The people ahead are simulated: in this sandbox
 * you're the only real buyer.
 */
import { own } from "./state";
import { findEvent } from "@/core/catalog";
import type { QueueStatus } from "@/core/statuses";
import type { BackendContext } from "./context";
import { fail, ok, type DomainError, type Result } from "./errors";
import type { QueueEntryRecord } from "./state";

/** Never ask a client to check back sooner than this, or later. */
const CHECK_AGAIN_MIN_MS = 1_000;
const CHECK_AGAIN_MAX_MS = 10_000;

export interface QueuePlace {
  status: QueueStatus;
  aheadCount: number;
  /** Until the line reaches you; 0 once it has. */
  estimatedWaitMs: number;
  /** When it's worth asking again — the server sets the pace. 0 when there's nothing left to wait for. */
  checkAgainAfterMs: number;
  /** The end of your turn, once you have one. */
  admittedUntilMs: number | null;
}

const clamp = (ms: number) => Math.min(CHECK_AGAIN_MAX_MS, Math.max(CHECK_AGAIN_MIN_MS, ms));

/** Where an entry stands at `nowMs`. */
export function placeAt(entry: QueueEntryRecord, nowMs: number): QueuePlace {
  const { joinedAtMs, aheadAtJoin, admittedPerBatch, batchIntervalMs, admissionWindowMs } = entry;
  const batchesSoFar = Math.max(0, Math.floor((nowMs - joinedAtMs) / batchIntervalMs));
  const aheadCount = Math.max(0, aheadAtJoin - batchesSoFar * admittedPerBatch);
  const admittedAtMs = joinedAtMs + Math.ceil(aheadAtJoin / admittedPerBatch) * batchIntervalMs;
  const admittedUntilMs = admittedAtMs + admissionWindowMs;

  if (nowMs < admittedAtMs) {
    const nextBatchAtMs = joinedAtMs + (batchesSoFar + 1) * batchIntervalMs;
    return {
      status: "waiting",
      aheadCount,
      estimatedWaitMs: admittedAtMs - nowMs,
      checkAgainAfterMs: clamp(nextBatchAtMs - nowMs),
      admittedUntilMs: null,
    };
  }
  if (nowMs < admittedUntilMs) {
    return {
      status: "admitted",
      aheadCount: 0,
      estimatedWaitMs: 0,
      checkAgainAfterMs: clamp(admittedUntilMs - nowMs),
      admittedUntilMs,
    };
  }
  return { status: "expired", aheadCount: 0, estimatedWaitMs: 0, checkAgainAfterMs: 0, admittedUntilMs };
}

const isLive = (entry: QueueEntryRecord, nowMs: number) => placeAt(entry, nowMs).status !== "expired";

/**
 * Join a sale's line. Joining again while your place is live returns that place:
 * one visitor, one place — a refresh or a double click can't send you to the back.
 */
export function joinQueue(
  context: BackendContext,
  eventSlug: string,
): Result<{ entry: QueueEntryRecord; isNew: boolean }> {
  const event = findEvent(eventSlug);
  if (!event) return fail({ code: "not_found", detail: "No such event." });
  const config = context.chaos().waitingRoom;
  if (!config) return fail({ code: "invalid_state", detail: "This sale has no queue right now." });

  const nowMs = context.deps.now();
  const existing = Object.values(context.state.queueEntries).find(
    (entry) => entry.eventSlug === eventSlug && isLive(entry, nowMs),
  );
  if (existing) return ok({ entry: existing, isNew: false });

  const entry: QueueEntryRecord = { token: context.deps.newId("q"), eventSlug, joinedAtMs: nowMs, ...config };
  context.state.queueEntries[entry.token] = entry;
  context.log("queue", `Joined the queue for ${event.name}: ${config.aheadAtJoin.toLocaleString("en-IN")} ahead.`);
  return ok({ entry, isNew: true });
}

export function findQueueEntry(context: BackendContext, token: string): Result<QueueEntryRecord> {
  const entry = own(context.state.queueEntries, token);
  return entry ? ok(entry) : fail({ code: "not_found", detail: "That place in the queue doesn’t exist." });
}

/**
 * May this visitor reserve for this sale? Always, when there's no waiting room;
 * otherwise only with a place in this sale's line whose turn has come and not gone.
 */
export function admissionProblem(
  context: BackendContext,
  eventSlug: string,
  queueToken: string | null,
): DomainError | null {
  if (!context.chaos().waitingRoom) return null;
  const entry = queueToken ? own(context.state.queueEntries, queueToken) : undefined;
  const required = (detail: string): DomainError => ({ code: "queue_required", detail, eventSlug });
  if (entry?.eventSlug !== eventSlug) {
    return required("This sale has a queue. Join it, and you can reserve when it’s your turn.");
  }
  switch (placeAt(entry, context.deps.now()).status) {
    case "waiting":
      return required("It isn’t your turn yet. You’ll keep your place in the queue.");
    case "expired":
      return required("Your turn has passed. Join the queue again to get another.");
    case "admitted":
      return null;
  }
}
