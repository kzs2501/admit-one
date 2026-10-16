// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend } from "@/backend/testing/fixtures";
import { IDEMPOTENCY_KEY_TTL_MS } from "./backend";

const response = { fingerprint: "abc", status: 202, body: {} };

describe("idempotency store", () => {
  it("forgets a key after 24 hours, as Stripe does", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.save("key-1", response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS - 1);
    expect(backend.idempotency.find("key-1")).toMatchObject(response);
    clock.advance(1);
    expect(backend.idempotency.find("key-1")).toBeUndefined();
  });

  it("drops expired keys when it saves, so it can't grow forever", () => {
    const { backend, clock } = createTestBackend();
    backend.idempotency.save("old", response);
    clock.advance(IDEMPOTENCY_KEY_TTL_MS);
    backend.idempotency.save("new", response);
    expect(Object.keys(backend.getState().idempotency)).toEqual(["new"]);
  });
});
