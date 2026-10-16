import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api-client";
import { shouldShowQueryError } from "./queries";

const problem = (status: number) =>
  new ApiError({ type: "https://admit-one.test/problems/not-found", title: "", status, detail: "", code: "not_found" });

describe("shouldShowQueryError", () => {
  it("shows nothing when nothing failed", () => {
    expect(shouldShowQueryError(undefined, null)).toBe(false);
    expect(shouldShowQueryError({}, null)).toBe(false);
  });

  it("shows any error when there's no data to fall back on", () => {
    expect(shouldShowQueryError(undefined, new NetworkError("offline"))).toBe(true);
    expect(shouldShowQueryError(undefined, problem(404))).toBe(true);
  });

  it("keeps the last good data through a glitch", () => {
    expect(shouldShowQueryError({}, new NetworkError("offline"))).toBe(false);
    expect(shouldShowQueryError({}, problem(503))).toBe(false);
  });

  it("lets a definitive answer replace stale data", () => {
    expect(shouldShowQueryError({}, problem(404))).toBe(true);
  });
});
