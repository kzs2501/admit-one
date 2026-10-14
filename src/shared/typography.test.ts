// @vitest-environment node
import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { presets } from "@/server/chaos";
import { attendeeSchema, cardSchema } from "./schemas";

/** Every string a visitor can read from the content modules. */
function strings(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      ["slug", "id", "startsAt"].includes(k) ? [] : strings(v, `${path}.${k}`),
    );
  }
  return [];
}

const validationMessages = [
  ...(attendeeSchema.safeParse({ name: "", email: "x" }).error?.issues ?? []),
  ...(cardSchema.safeParse({ number: "1", expiry: "", cvc: "", name: "" }).error?.issues ?? []),
].map((i) => i.message);

describe("visible copy", () => {
  const all = [
    ...strings(catalog, "catalog"),
    ...strings(
      presets.map(({ label, description, expectation }) => ({ label, description, expectation })),
      "presets",
    ),
    ...validationMessages.map((m, i) => [`validation[${i}]`, m] as [string, string]),
  ];

  it("uses curly apostrophes and quotes, never straight ones", () => {
    expect(all.filter(([, s]) => /['"]/.test(s)).map(([p, s]) => `${p}: ${s}`)).toEqual([]);
  });

  it("uses a real ellipsis", () => {
    expect(all.filter(([, s]) => s.includes("...")).map(([p]) => p)).toEqual([]);
  });

  it("actually checks something", () => {
    expect(all.length).toBeGreaterThan(40);
  });
});
