/**
 * Idempotency keys for payments: one per *attempt*. Retrying the same request —
 * after a timeout, say — reuses the key, so the server recognises the retry and
 * never charges twice. A different card is a different request, so it gets a new
 * key: the server refuses a key reused for a different request. (Paying twice for
 * one order is still impossible — the server refuses a second payment while one
 * is in flight or done.)
 *
 * "The same card" is what the server compares (`backend/http/idempotency.ts`): its
 * number, expiry and name. Not the CVC, which the server never keeps in any form, so a
 * corrected CVC is a retry of the same request.
 */
import { normalizeCardNumber, type CardInput } from "@/core/schemas";

export interface Attempt {
  key: string;
  /** The card the attempt is for, as the server tells requests apart. */
  card: string;
}

const cardIdentity = ({ number, expiry, name }: Pick<CardInput, "number" | "expiry" | "name">) =>
  [normalizeCardNumber(number), expiry.replaceAll(/\s/g, ""), name.trim()].join("|");

export function attemptFor(
  previous: Attempt | null,
  card: Pick<CardInput, "number" | "expiry" | "name">,
  mint: () => string,
): Attempt {
  const identity = cardIdentity(card);
  return previous?.card === identity ? previous : { key: mint(), card: identity };
}
