import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUMMIT } from "@/contract/testing/dto-fixtures";
import { apiClient } from "@/lib/api-client";
import { useReserveHold } from "./use-reserve-hold";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reserving", () => {
  it("sends one request for two presses in a row", async () => {
    // Still waiting for the server when the second press comes.
    const createHold = vi.spyOn(apiClient, "createHold").mockReturnValue(new Promise(() => undefined));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReserveHold(vi.fn()), { wrapper });
    const request = { eventSlug: SUMMIT.eventSlug, items: SUMMIT.items };
    act(() => {
      result.current.reserve(request);
    });
    await waitFor(() => {
      expect(result.current.isReserving).toBe(true);
    });
    // A mutation calls its function a moment after `mutate`: give a second one that moment.
    await act(async () => {
      result.current.reserve(request);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(createHold).toHaveBeenCalledTimes(1);
  });
});
