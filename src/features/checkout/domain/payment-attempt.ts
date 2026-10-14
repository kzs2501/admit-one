/**
 * Idempotency keys for payments: one per *attempt*. Retrying the same request —
 * after a timeout, say — reuses the key, so the server recognises the retry and
 * never charges twice. A different card is a different request, so it gets a new
 * key: the server rejects a key reused for a different request. (Paying twice for
 * one order is still impossible — the server refuses a second payment while one
 * is in flight or done.)
 */
import { normalizeCardNumber } from "@/core/schemas";

export type Attempt = { key: string; card: string };

export function attemptFor(previous: Attempt | null, cardNumber: string, mint: () => string): Attempt {
  const card = normalizeCardNumber(cardNumber);
  return previous?.card === card ? previous : { key: mint(), card };
}
