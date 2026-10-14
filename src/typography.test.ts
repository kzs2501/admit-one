// @vitest-environment node
/** Copy standards for everything a visitor can read: curly quotes and real ellipses. */
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/backend/chaos/presets";
import { PROBLEM_CATALOG } from "@/contract/problems";
import { CATALOG } from "@/core/catalog";
import { attendeeSchema, cardSchema } from "@/core/schemas";

interface LabelledString {
  path: string;
  text: string;
}

/** Keys that hold identifiers or machine values, not copy. */
const NON_COPY_KEYS = new Set(["slug", "id", "startsAt", "timeZone", "currency"]);

/** Every string a visitor can read from a content module, with where it came from. */
function collectStrings(value: unknown, path: string): LabelledString[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => collectStrings(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      NON_COPY_KEYS.has(key) ? [] : collectStrings(child, `${path}.${key}`),
    );
  }
  return [];
}

const validationMessages = [
  ...(attendeeSchema.safeParse({ name: "", email: "x" }).error?.issues ?? []),
  ...(cardSchema.safeParse({ number: "1", expiry: "", cvc: "", name: "" }).error?.issues ?? []),
].map((issue) => issue.message);

describe("visible copy", () => {
  const copy = [
    ...collectStrings(CATALOG, "CATALOG"),
    ...collectStrings(
      PRESETS.map(({ label, description, expectation }) => ({ label, description, expectation })),
      "PRESETS",
    ),
    ...collectStrings(PROBLEM_CATALOG, "PROBLEM_CATALOG"),
    ...validationMessages.map((text, i) => ({ path: `validation[${i}]`, text })),
  ];

  it("uses curly apostrophes and quotes, never straight ones", () => {
    // Backticks are allowed: problem descriptions use them to mark code, like `available`.
    expect(copy.filter(({ text }) => /['"]/.test(text)).map(({ path, text }) => `${path}: ${text}`)).toEqual([]);
  });

  it("uses a real ellipsis", () => {
    expect(copy.filter(({ text }) => text.includes("...")).map(({ path }) => path)).toEqual([]);
  });

  it("actually checks something", () => {
    expect(copy.length).toBeGreaterThan(60);
  });
});
