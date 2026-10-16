// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprintRequest } from "./idempotency";

const card = { number: "4242 4242 4242 4242", expiry: "12 / 30", cvc: "123", name: "Asha Rao" };

describe("canonicalJson", () => {
  it("ignores key order, at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }),
    );
  });

  it("keeps array order, which is meaningful", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("fingerprintRequest", () => {
  const fingerprint = (body: unknown, path = "/api/orders/ord_1/payments") => fingerprintRequest("POST", path, body);

  it("is a SHA-256 hex digest that doesn't contain the card", async () => {
    const value = await fingerprint(card);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).not.toContain("4242");
  });

  it("is the same for the same request, whatever the key order", async () => {
    const reordered = { name: card.name, cvc: card.cvc, expiry: card.expiry, number: card.number };
    expect(await fingerprint(card)).toBe(await fingerprint(reordered));
  });

  it("changes with any parameter, not just the last four digits", async () => {
    const original = await fingerprint(card);
    for (const changed of [{ expiry: "11 / 29" }, { cvc: "999" }, { name: "Someone Else" }]) {
      expect(await fingerprint({ ...card, ...changed })).not.toBe(original);
    }
    expect(await fingerprint(card, "/api/orders/ord_2/payments")).not.toBe(original);
  });
});
