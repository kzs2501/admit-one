// @vitest-environment node
import { describe, expect, it } from "vitest";
import { attendeesSchema, cardSchema, lineItemsSchema, passesLuhn } from "./schemas";

describe("card validation", () => {
  it("checks card numbers with Luhn", () => {
    expect(passesLuhn("4242424242424242")).toBe(true);
    expect(passesLuhn("4242424242424241")).toBe(false);
    expect(passesLuhn("42")).toBe(false);
  });

  it("normalises spaces in card numbers and checks expiry and CVC", () => {
    const valid = cardSchema.safeParse({
      number: "4242 4242 4242 4242",
      expiry: "08 / 29",
      cvc: "123",
      name: "Asha Rao",
    });
    expect(valid.success && valid.data.number).toBe("4242424242424242");
    expect(cardSchema.safeParse({ number: "4242424242424242", expiry: "13/29", cvc: "1", name: "A" }).success).toBe(
      false,
    );
  });
});

describe("attendee validation", () => {
  it("requires exactly one valid attendee per ticket", () => {
    const attendee = { name: "Asha Rao", email: "asha@example.com" };
    expect(attendeesSchema(2).safeParse([attendee, attendee]).success).toBe(true);
    expect(attendeesSchema(2).safeParse([attendee]).success).toBe(false);
    expect(attendeesSchema(1).safeParse([{ name: "A", email: "nope" }]).success).toBe(false);
  });
});

describe("ticket request validation", () => {
  it("needs at least one ticket and at most six", () => {
    expect(lineItemsSchema.safeParse([]).success).toBe(false);
    expect(lineItemsSchema.safeParse([{ tierId: "t", quantity: 6 }]).success).toBe(true);
    expect(
      lineItemsSchema.safeParse([
        { tierId: "a", quantity: 4 },
        { tierId: "b", quantity: 3 },
      ]).success,
    ).toBe(false);
  });
});
