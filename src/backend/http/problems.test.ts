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
      const problem = toProblem(sampleError(code), "/api/somewhere");
      expect(problem).toMatchObject({
        code,
        status: PROBLEM_CATALOG[code].status,
        title: PROBLEM_CATALOG[code].title,
        type: `/problems/${code.replaceAll("_", "-")}`,
        instance: "/api/somewhere",
      });
      expect(problemSchema.safeParse(problem).success, code).toBe(true);
    }
  });

  it("keeps extension members and the buyer-facing detail", () => {
    expect(toProblem(sampleError("sold_out"), "/api/holds")).toMatchObject({ available: 2, detail: "Only 2 left." });
  });
});
