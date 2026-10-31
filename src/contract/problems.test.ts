// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findProblemCodeBySlug, PROBLEM_CATALOG, PROBLEM_CODES, problemSchema, problemTypeFor } from "./problems";

const ORIGIN = "https://dresscircle.test";

describe("problem types", () => {
  it("documents every code, with a client- or server-error status", () => {
    expect(new Set(PROBLEM_CODES).size).toBe(PROBLEM_CODES.length);
    for (const code of PROBLEM_CODES) {
      const { status, title, description } = PROBLEM_CATALOG[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(title.length, code).toBeGreaterThan(0);
      expect(description.length, code).toBeGreaterThan(0);
    }
  });

  it("gives each code an absolute type URI that round-trips to it", () => {
    expect(problemTypeFor("sold_out", ORIGIN)).toBe(`${ORIGIN}/problems/sold-out`);
    for (const code of PROBLEM_CODES) {
      const slug = new URL(problemTypeFor(code, ORIGIN)).pathname.split("/").at(-1) ?? "";
      expect(findProblemCodeBySlug(slug)).toBe(code);
    }
    expect(findProblemCodeBySlug("not-a-problem")).toBeUndefined();
  });

  it("requires the extension members a problem promises", () => {
    const base = { type: `${ORIGIN}/problems/sold-out`, title: "t", status: 409, detail: "d" };
    expect(problemSchema.safeParse({ ...base, code: "sold_out", tierId: "x", available: 1 }).success).toBe(true);
    expect(problemSchema.safeParse({ ...base, code: "sold_out" }).success).toBe(false);
    expect(problemSchema.safeParse({ ...base, code: "made_up" }).success).toBe(false);
  });

  it("insists on absolute type and instance URIs", () => {
    const valid = { type: `${ORIGIN}/problems/not-found`, title: "t", status: 404, detail: "d", code: "not_found" };
    expect(problemSchema.safeParse({ ...valid, instance: `${ORIGIN}/api/holds/x` }).success).toBe(true);
    expect(problemSchema.safeParse({ ...valid, type: "/problems/not-found" }).success).toBe(false);
    expect(problemSchema.safeParse({ ...valid, instance: "/api/holds/x" }).success).toBe(false);
  });
});
