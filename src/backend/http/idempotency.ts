/**
 * What "the same request" means for an Idempotency-Key (after Stripe): the same method,
 * path and body, compared exactly — every parameter, not a summary of them. Requests
 * are compared by a SHA-256 hash, so the stored state never holds card details.
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

export async function fingerprintRequest(method: string, path: string, body: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${method} ${path}\n${canonicalJson(body)}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
