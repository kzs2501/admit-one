import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/lib/api-client";
import { organiserApi } from "@/lib/organiser-api";
import type * as LiveUpdates from "@/features/organiser/hooks/use-live-updates";
import { FALLBACK_POLL_MS, type LiveStatus } from "@/features/organiser/hooks/use-live-updates";
import { OrderDetail } from "./order-detail";

const live = vi.hoisted((): { status: LiveStatus } => ({ status: "live" }));
vi.mock("@/features/organiser/hooks/use-live-updates", async (importOriginal) => ({
  ...(await importOriginal<typeof LiveUpdates>()),
  useLiveUpdates: () => ({
    status: live.status,
    isPaused: false,
    setIsPaused: () => undefined,
    changes: { latest: 0, byEvent: {}, caughtUpAt: 0 },
  }),
}));

const notFound = new ApiError({
  type: "https://dresscircle.test/problems/not-found",
  title: "Not found",
  status: 404,
  detail: "There's no such order.",
  code: "not_found",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(organiserApi, "getAccount").mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function askedForOrderOverAPoll(status: LiveStatus, failure: Error) {
  live.status = status;
  const getOrder = vi.spyOn(organiserApi, "getOrder").mockRejectedValue(failure);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrderDetail orderId="ord_h00001" />
    </QueryClientProvider>,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS * 2);
  return getOrder.mock.calls.length;
}

describe("OrderDetail", () => {
  it("polls while the live stream is down, as the status line says", async () => {
    expect(await askedForOrderOverAPoll("reconnecting", new NetworkError("Couldn’t reach the server."))).toBe(3);
  });

  it("doesn't poll while the stream is live: a change re-reads it", async () => {
    expect(await askedForOrderOverAPoll("live", new NetworkError("Couldn’t reach the server."))).toBe(1);
  });

  it("stops asking for an order that isn't there", async () => {
    expect(await askedForOrderOverAPoll("reconnecting", notFound)).toBe(1);
  });
});
