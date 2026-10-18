import { describe, expect, it } from "vitest";
import { cardSchema } from "@/core/schemas";
import { TEST_CARD_CVC, TEST_CARD_EXPIRY, TEST_CARD_OPTIONS } from "./test-cards";

describe("test cards", () => {
  it("offers only cards the payment form would accept — a typo would surface only at Pay", () => {
    for (const { label, number } of TEST_CARD_OPTIONS) {
      const parsed = cardSchema.safeParse({ number, expiry: TEST_CARD_EXPIRY, cvc: TEST_CARD_CVC, name: "Test Buyer" });
      expect(parsed.success, label).toBe(true);
    }
  });

  it("labels each card once", () => {
    const labels = TEST_CARD_OPTIONS.map((card) => card.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
