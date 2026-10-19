// @vitest-environment node
import { describe, expect, it } from "vitest";
import { guardFormula, toCsv } from "./csv";

describe("CSV", () => {
  it("starts with a byte-order mark and ends every record with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("﻿a,b\r\n1,x\r\n");
  });

  it("quotes fields with commas, quotes or line breaks, doubling quotes", () => {
    const csv = toCsv(["name"], [[{ text: 'Rao, "Nandini"' }], [{ text: "two\nlines" }]]);
    expect(csv).toBe('﻿name\r\n"Rao, ""Nandini"""\r\n"two\nlines"\r\n');
  });

  it.each(['=HYPERLINK("http://x")', "+91 98765", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "makes %j text, not a formula",
    (text) => {
      expect(guardFormula(text).startsWith("'")).toBe(true);
    },
  );

  it("guards only what buyers typed: numbers stay numbers", () => {
    expect(toCsv(["n", "t"], [[-5, { text: "-5" }]])).toBe("﻿n,t\r\n-5,'-5\r\n");
    expect(guardFormula("Asha")).toBe("Asha");
  });
});
