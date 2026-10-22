/**
 * What "the same request" means for an Idempotency-Key (after Stripe): the same method,
 * path and body, compared exactly — every parameter but one, not a summary of them.
 *
 * Requests are compared by a hash, never stored as they are. The card's CVC isn't in
 * it at all: PCI DSS allows a keyed hash of a card number, but no form of the CVC after
 * authorisation. On the server the hash is an HMAC under a secret
 * (`FINGERPRINT_SECRET`), so a stolen database can't be searched for the card numbers
 * behind it; the sandbox's state never leaves the buyer's own browser, so it uses a
 * plain SHA-256.
 */

/** JSON with object keys sorted, so `{ a, b }` and `{ b, a }` are the same request. */
export function canonicalJson(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    // Code-unit order, not locale order: a canonical form can't depend on where it runs.
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}

/** Fields never hashed, at any depth: the card's security code. */
const NEVER_HASHED = new Set(["cvc"]);

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NEVER_HASHED.has(key))
        .map(([key, entry]) => [key, withoutSecrets(entry)]),
    );
  }
  return value;
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** A request's fingerprint: an HMAC-SHA256 under `secret` when there is one, a SHA-256 when not. */
export async function fingerprintRequest(
  method: string,
  path: string,
  body: unknown,
  secret: string | null = null,
): Promise<string> {
  const message = new TextEncoder().encode(`${method} ${path}\n${canonicalJson(withoutSecrets(body))}`);
  if (secret === null) return hex(await crypto.subtle.digest("SHA-256", message));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, message));
}
