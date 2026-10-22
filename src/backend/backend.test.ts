// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend } from "@/backend/testing/fixtures";
import { IDEMPOTENCY_KEY_TTL_MS } from "./backend";
import type { IdempotencyClaim } from "./idempotency-store";

const response = { fingerprint: "abc", status: 202, body: {} };

/** The token of a claim that should have been granted. */
function tokenOf(claim: IdempotencyClaim) {
  if (claim.kind !== "claimed") throw new Error(`Expected the key to be claimed, not ${claim.kind}`);
  return claim.token;
}

describe("idempotency store", () => {
  it("hands a new key to the first request, and says it's in flight until that one finishes", () => {
    const { backend } = createTestBackend();
    const token = tokenOf(backend.idempotency.claim("key-1", "abc"));
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "in-flight", fingerprint: "abc" });
    backend.idempotency.complete("key-1", token, response);
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "stored", record: response });
  });

  it("frees a released key, for a request that was turned away before anything happened", () => {
    const { backend } = createTestBackend();
    backend.idempotency.release("key-1", tokenOf(backend.idempotency.claim("key-1", "abc")));
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "claimed" });
  });

  it("takes an answer or a release only from the request that holds the claim", () => {
    const { backend } = createTestBackend();
    tokenOf(backend.idempotency.claim("key-1", "abc"));
    backend.idempotency.complete("key-1", "someone-else", response);
    backend.idempotency.release("key-1", "someone-else");
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "in-flight", fingerprint: "abc" });
  });

  it("forgets a key after 24 hours, as Stripe does", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.complete("key-1", tokenOf(backend.idempotency.claim("key-1", "abc")), response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS - 1);
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "stored" });
    clock.advance(1);
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "claimed" });
  });

  it("drops expired keys when it saves, so it can't grow forever", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.complete("old", tokenOf(backend.idempotency.claim("old", "abc")), response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS);
    backend.idempotency.complete("new", tokenOf(backend.idempotency.claim("new", "abc")), response);
    expect(Object.keys(backend.getState().idempotency)).toEqual(["new"]);
  });
});
