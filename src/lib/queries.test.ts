import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { HoldDetailsDto } from "@/contract/dto";
import { ApiError, NetworkError } from "./api-client";
import { holdQueries, patchHoldDetails, retryDelay, retryPolicy, shouldShowQueryError } from "./queries";

const problem = (status: number) =>
  new ApiError({
    type: "https://dresscircle.test/problems/not-found",
    title: "",
    status,
    detail: "",
    code: "not_found",
  });

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
        type: "https://dresscircle.test/problems/rate-limited",
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

describe("patchHoldDetails", () => {
  const details = { serverTime: "2026-10-19T10:00:00.000Z", order: { id: "ord_1" } } as unknown as HoldDetailsDto;

  it("keeps the time the details were fetched, so a countdown's clock correction stays true", () => {
    const queryClient = new QueryClient();
    const { queryKey } = holdQueries.detail("hold_1");
    queryClient.setQueryData(queryKey, details, { updatedAt: 1_000 });
    patchHoldDetails(queryClient, "hold_1", (cached) => ({ ...cached, order: null }));
    const state = queryClient.getQueryState(queryKey);
    expect(state?.data).toMatchObject({ serverTime: details.serverTime, order: null });
    expect(state?.dataUpdatedAt).toBe(1_000);
  });

  it("leaves details that were never fetched alone", () => {
    const queryClient = new QueryClient();
    patchHoldDetails(queryClient, "hold_1", (cached) => cached);
    expect(queryClient.getQueryData(holdQueries.detail("hold_1").queryKey)).toBeUndefined();
  });
});
