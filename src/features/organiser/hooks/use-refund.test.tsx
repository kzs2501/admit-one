import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderPageDto, OrganiserOrderDto } from "@/contract/dto";
import { ApiError, NetworkError } from "@/lib/api-client";
import { organiserApi } from "@/lib/organiser-api";
import { organiserQueries } from "@/lib/queries";
import { DEFAULT_ORDER_BY } from "@/contract/queries";
import { useRefund } from "./use-refund";

const order = {
  id: "ord_h00001",
  status: "fulfilled",
  refundStatus: null,
  totalMinor: 303_729,
  currency: "INR",
} as OrganiserOrderDto;

const listKey = organiserQueries.orders({ status: [], orderBy: DEFAULT_ORDER_BY }).queryKey;
const page: InfiniteData<OrderPageDto, string | undefined> = {
  pages: [{ orders: [{ ...order, refundStatus: null }], nextPageToken: null, totalSize: 1 }],
  pageParams: [undefined],
};

const refundFailed = new ApiError({
  type: "https://admit-one.test/problems/refund-failed",
  title: "The refund couldn’t start",
  status: 502,
  detail: "The payment provider couldn’t start the refund.",
  code: "refund_failed",
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.setQueryData(organiserQueries.order(order.id).queryKey, order);
  queryClient.setQueryData(listKey, page);
  const onFailed = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useRefund(order, { onFailed }), { wrapper });
  const rowStatus = () => queryClient.getQueryData(listKey)?.pages[0]?.orders[0]?.refundStatus;
  const orderStatus = () => queryClient.getQueryData(organiserQueries.order(order.id).queryKey)?.refundStatus;
  return { result, onFailed, rowStatus, orderStatus };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRefund", () => {
  it("marks the order and its rows pending at once, and puts both back when the refund fails", async () => {
    let fail: (error: unknown) => void = () => undefined;
    vi.spyOn(organiserApi, "requestRefund").mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const { result, onFailed, rowStatus, orderStatus } = setup();
    act(() => {
      result.current.mutate("other");
    });
    await waitFor(() => {
      expect(orderStatus()).toBe("pending");
    });
    expect(rowStatus()).toBe("pending");

    act(() => {
      fail(refundFailed);
    });
    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith("The payment provider couldn’t start the refund.");
    });
    expect(orderStatus()).toBeNull();
    expect(rowStatus()).toBeNull();
  });

  it("keeps the idempotency key after a lost connection, and starts afresh after an answer", async () => {
    const requestRefund = vi
      .spyOn(organiserApi, "requestRefund")
      .mockRejectedValueOnce(new NetworkError("Couldn’t reach the server."))
      .mockRejectedValueOnce(refundFailed)
      .mockRejectedValueOnce(refundFailed);
    const { result, onFailed } = setup();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await act(async () => {
        await result.current.mutateAsync("other").catch(() => undefined);
      });
    }
    const keys = requestRefund.mock.calls.map((call) => call[2]);
    expect(keys[1]).toBe(keys[0]); // a retry after a lost connection is the same request
    expect(keys[2]).not.toBe(keys[1]); // after the server's answer, a new attempt is a new request
    expect(onFailed).toHaveBeenNthCalledWith(1, expect.stringMatching(/^The connection dropped/));
  });

  it("gives a retry with another reason its own key, which the same key would have been refused", async () => {
    const requestRefund = vi
      .spyOn(organiserApi, "requestRefund")
      .mockRejectedValueOnce(new NetworkError("Couldn’t reach the server."))
      .mockRejectedValueOnce(new NetworkError("Couldn’t reach the server."));
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync("other").catch(() => undefined);
    });
    await act(async () => {
      await result.current.mutateAsync("event_changed").catch(() => undefined);
    });
    const [first, second] = requestRefund.mock.calls.map((call) => call[2]);
    expect(second).not.toBe(first);
  });
});
