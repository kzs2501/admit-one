/** The idempotency store's contract, shared by the sandbox and the server backend. */
import type { IdempotencyRecord } from "./domain/state";

export type Awaitable<T> = T | Promise<T>;

/** What's known about an Idempotency-Key when a request arrives with it. */
export type IdempotencyClaim =
  /**
   * The key is new: this request has it, and must `complete` or `release` it with this
   * token. If its request takes so long that a retry claims the key again, the token no
   * longer matches, so the slow one can't overwrite or give back the retry's claim.
   */
  | { kind: "claimed"; token: string }
  /** Another request with the key hasn't finished yet. */
  | { kind: "in-flight"; fingerprint: string }
  /** A request with the key finished: here's what it was answered. */
  | { kind: "stored"; record: IdempotencyRecord };

/**
 * Idempotency-Keys, claimed before the work starts. Checking and saving afterwards
 * isn't enough once the work itself is awaited: two requests with the same key could
 * both find nothing and both charge.
 */
export interface IdempotencyStore {
  claim: (key: string, fingerprint: string) => Awaitable<IdempotencyClaim>;
  /** Keep the answer to a claimed key's request, for its retries. */
  complete: (key: string, token: string, record: Omit<IdempotencyRecord, "createdAtMs">) => Awaitable<void>;
  /** Give back a claimed key whose request was turned away before anything happened. */
  release: (key: string, token: string) => Awaitable<void>;
}
