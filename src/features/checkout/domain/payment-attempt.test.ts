import { describe, expect, it } from "vitest";
import { attemptFor } from "./payment-attempt";

describe("payment attempts", () => {
  const mint = (() => {
    let keyCount = 0;
    return () => `key_${++keyCount}`;
  })();

  it("reuses the key for a retry of the same card, however it's typed", () => {
    const first = attemptFor(null, "4242 4242 4242 4242", mint);
    expect(attemptFor(first, "4242-4242-4242-4242", mint)).toBe(first);
  });

  it("mints a new key when the card changes, or after a definitive answer", () => {
    const first = attemptFor(null, "4242424242424242", mint);
    expect(attemptFor(first, "4000002500003155", mint).key).not.toBe(first.key);
    expect(attemptFor(null, "4242424242424242", mint).key).not.toBe(first.key);
  });
});
