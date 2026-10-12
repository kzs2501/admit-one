// @vitest-environment node
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { formatMoney, priceOrder, describeItems } from "./money";
import { attendeesSchema, cardSchema, passesLuhn } from "./schemas";

const summit = catalog.find((e) => e.slug === "frontend-systems-summit")!;

describe("money", () => {
  it("prices tickets, add-ons and the fee in integer cents", () => {
    const a = priceOrder(summit, [{ tierId: "fss-general", qty: 1 }], {});
    expect(a).toEqual({ ticketsCents: 14900, addOnsCents: 0, feesCents: 447, totalCents: 15347 });
    for (const v of Object.values(a)) expect(Number.isInteger(v)).toBe(true);
  });

  it("rounds the fee half-up without floats", () => {
    // 3% of $0.50 = 1.5¢ → 2¢; 3% of $0.49 = 1.47¢ → 1¢
    const fake = { ...summit, tiers: [{ ...summit.tiers[0], id: "t", priceCents: 50 }], addOns: [] };
    expect(priceOrder(fake, [{ tierId: "t", qty: 1 }], {}).feesCents).toBe(2);
    expect(priceOrder({ ...fake, tiers: [{ ...fake.tiers[0], priceCents: 49 }] }, [{ tierId: "t", qty: 1 }], {}).feesCents).toBe(1);
  });

  it("rejects tiers and add-ons from other events", () => {
    expect(() => priceOrder(summit, [{ tierId: "nmj-standing", qty: 1 }], {})).toThrow();
    expect(() => priceOrder(summit, [], { nope: 1 })).toThrow();
  });

  it("formats and describes", () => {
    expect(formatMoney(34402)).toBe("$344.02");
    expect(describeItems("frontend-systems-summit", [{ tierId: "fss-general", qty: 2 }, { tierId: "fss-workshop", qty: 1 }])).toBe(
      "2 × General, 1 × Workshop + General",
    );
  });
});

describe("validation", () => {
  it("checks card numbers with Luhn", () => {
    expect(passesLuhn("4242424242424242")).toBe(true);
    expect(passesLuhn("4242424242424241")).toBe(false);
    expect(passesLuhn("42")).toBe(false);
  });

  it("normalises spaces in card numbers and checks expiry and CVC", () => {
    const ok = cardSchema.safeParse({ number: "4242 4242 4242 4242", expiry: "08 / 29", cvc: "123", name: "Asha Rao" });
    expect(ok.success && ok.data.number).toBe("4242424242424242");
    expect(cardSchema.safeParse({ number: "4242424242424242", expiry: "13/29", cvc: "1", name: "A" }).success).toBe(false);
  });

  it("requires exactly one valid attendee per ticket", () => {
    const one = { name: "Asha Rao", email: "asha@example.com" };
    expect(attendeesSchema(2).safeParse([one, one]).success).toBe(true);
    expect(attendeesSchema(2).safeParse([one]).success).toBe(false);
    expect(attendeesSchema(1).safeParse([{ name: "A", email: "nope" }]).success).toBe(false);
  });
});

describe("catalogue", () => {
  it("has unique ids, and baselines within capacity", () => {
    const tiers = catalog.flatMap((e) => e.tiers);
    expect(new Set(tiers.map((t) => t.id)).size).toBe(tiers.length);
    for (const t of tiers) expect(t.baselineSold).toBeLessThan(t.capacity);
  });
});
