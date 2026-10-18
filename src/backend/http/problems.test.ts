// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PROBLEM_CATALOG, PROBLEM_CODES, problemSchema } from "@/contract/problems";
import type { DomainError } from "@/backend/domain/errors";
import { toProblem } from "./problems";

/** One domain error per code, with whatever extension members that code requires. */
function sampleError(code: (typeof PROBLEM_CODES)[number]): DomainError {
  switch (code) {
    case "sold_out":
      return { code, detail: "Only 2 left.", tierId: "nmj-standing", available: 2 };
    case "seats_unavailable":
    case "single_seat_gap":
      return { code, detail: "Stalls, row F, seat 12.", seatIds: ["stalls-F-12"] };
    case "queue_required":
      return { code, detail: "It isn’t your turn yet.", eventSlug: "monsoon-strings" };
    case "rate_limited":
      return { code, detail: "Too many attempts.", retryAfterSeconds: 12 };
    case "card_declined":
    case "authentication_failed":
      return { code, detail: "The bank said no.", paymentId: "pay_1" };
    default:
      return { code, detail: "Something specific went wrong." };
  }
}

describe("domain errors as problem details", () => {
  it("gives every code its catalogued status, title and type, and a valid body", () => {
    for (const code of PROBLEM_CODES) {
      const problem = toProblem(sampleError(code), "https://admit-one.test/api/somewhere?x=1");
      expect(problem).toMatchObject({
        code,
        status: PROBLEM_CATALOG[code].status,
        title: PROBLEM_CATALOG[code].title,
        type: `https://admit-one.test/problems/${code.replaceAll("_", "-")}`,
        instance: "https://admit-one.test/api/somewhere?x=1",
      });
      expect(problemSchema.safeParse(problem).success, code).toBe(true);
    }
  });

  it("keeps extension members and the buyer-facing detail", () => {
    expect(toProblem(sampleError("sold_out"), "https://admit-one.test/api/holds")).toMatchObject({
      available: 2,
      detail: "Only 2 left.",
    });
  });
});
