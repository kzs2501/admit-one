import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url";

describe("base64url", () => {
  it("round-trips bytes, with no padding and no + or /", () => {
    const bytes = Uint8Array.from([0, 251, 255, 62, 63, 1]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it("refuses text that isn't base64url", () => {
    expect(fromBase64Url("a+b/")).toBeNull();
    expect(fromBase64Url("abcde")).toBeNull();
  });
});
