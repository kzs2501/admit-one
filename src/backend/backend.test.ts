// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend } from "@/backend/testing/fixtures";
import { IDEMPOTENCY_KEY_TTL_MS } from "./backend";

const response = { fingerprint: "abc", status: 202, body: {} };

describe("idempotency store", () => {
  it("hands a new key to the first request, and says it's in flight until that one finishes", () => {
    const { backend } = createTestBackend();
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "claimed" });
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "in-flight", fingerprint: "abc" });
    backend.idempotency.complete("key-1", response);
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "stored", record: response });
  });

  it("frees a released key, for a request that was turned away before anything happened", () => {
    const { backend } = createTestBackend();
    backend.idempotency.claim("key-1", "abc");
    backend.idempotency.release("key-1");
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "claimed" });
  });

  it("forgets a key after 24 hours, as Stripe does", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.claim("key-1", "abc");
    backend.idempotency.complete("key-1", response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS - 1);
    expect(backend.idempotency.claim("key-1", "abc")).toMatchObject({ kind: "stored" });
    clock.advance(1);
    expect(backend.idempotency.claim("key-1", "abc")).toEqual({ kind: "claimed" });
  });

  it("drops expired keys when it saves, so it can't grow forever", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.complete("old", response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS);
    backend.idempotency.complete("new", response);
    expect(Object.keys(backend.getState().idempotency)).toEqual(["new"]);
  });
});
