import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api-client";
import { retryDelay, retryPolicy, shouldShowQueryError } from "./queries";

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

describe("retrying", () => {
  const rateLimited = (retryAfterMs: number | null) =>
    new ApiError(
      {
        type: "https://admit-one.test/problems/rate-limited",
        title: "",
        status: 429,
        detail: "",
        code: "rate_limited",
        retryAfterSeconds: 13,
      },
      retryAfterMs,
    );

  it("retries glitches and a 429, twice at most, but never another answer", () => {
    expect(retryPolicy(0, new NetworkError("offline"))).toBe(true);
    expect(retryPolicy(0, rateLimited(13_000))).toBe(true);
    expect(retryPolicy(2, new NetworkError("offline"))).toBe(false);
    expect(retryPolicy(0, problem(404))).toBe(false);
  });

  it("waits exactly as long as the server asked, and otherwise backs off", () => {
    expect(retryDelay(0, rateLimited(13_000))).toBe(13_000);
    expect(retryDelay(0, new NetworkError("offline"))).toBe(1_000);
    expect(retryDelay(1, rateLimited(null))).toBe(2_000);
    expect(retryDelay(10, new NetworkError("offline"))).toBe(30_000);
  });
});
