import { describe, expect, it } from "vitest";
import { attemptFor } from "./payment-attempt";

describe("payment attempts", () => {
  const mint = (() => {
    let keyCount = 0;
    return () => `key_${++keyCount}`;
  })();
  const card = { number: "4242 4242 4242 4242", expiry: "12 / 30", name: "Asha Rao" };

  it("reuses the key for a retry of the same card, however it's typed", () => {
    const first = attemptFor(null, card, mint);
    expect(
      attemptFor(first, { ...card, number: "4242-4242-4242-4242", expiry: "12/30", name: " Asha Rao " }, mint),
    ).toBe(first);
  });

  it("mints a new key when the number, expiry or name changes, or after a definitive answer", () => {
    const first = attemptFor(null, card, mint);
    for (const changed of [{ number: "4000002500003155" }, { expiry: "11 / 29" }, { name: "Someone Else" }]) {
      expect(attemptFor(first, { ...card, ...changed }, mint).key).not.toBe(first.key);
    }
    expect(attemptFor(null, card, mint).key).not.toBe(first.key);
  });
});
