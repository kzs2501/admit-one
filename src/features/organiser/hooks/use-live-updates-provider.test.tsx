import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORDER_BY } from "@/contract/queries";
import type * as EventStream from "@/lib/event-stream";
import type { StreamEvent } from "@/lib/event-stream";
import { organiserQueries } from "@/lib/queries";
import { LiveUpdatesProvider, useLiveUpdates } from "./use-live-updates";

// The stream, by hand: each connection can be opened, sent events, and dropped.
const streams = vi.hoisted(() => [] as { open: () => void; send: (event: StreamEvent) => void; drop: () => void }[]);
vi.mock("@/lib/event-stream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventStream>()),
  readEventStream: (
    ...[, { onOpen, onEvent }]: [url: string, handlers: { onOpen: () => void; onEvent: (event: StreamEvent) => void }]
  ) =>
    new Promise<void>((_, reject) => {
      streams.push({ open: onOpen, send: onEvent, drop: () => reject(new Error("The stream dropped.")) });
    }),
}));

afterEach(() => {
  streams.length = 0;
  vi.restoreAllMocks();
});

const listKey = organiserQueries.orders({ status: [], orderBy: DEFAULT_ORDER_BY }).queryKey;
const metricsKey = organiserQueries.metrics().queryKey;

function setup() {
  vi.spyOn(Math, "random").mockReturnValue(0); // reconnect at once
  const client = new QueryClient();
  client.setQueryData(listKey, { pages: [], pageParams: [] });
  client.setQueryData(metricsKey, {} as never);
  const live: { current: ReturnType<typeof useLiveUpdates> | null } = { current: null };
  function Probe() {
    live.current = useLiveUpdates();
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <LiveUpdatesProvider>
        <Probe />
      </LiveUpdatesProvider>
    </QueryClientProvider>,
  );
  const stream = async (n: number) => {
    await waitFor(() => {
      expect(streams).toHaveLength(n + 1);
    });
    const connection = streams[n];
    if (!connection) throw new Error(`No connection ${String(n)}`);
    return connection;
  };
  return { client, live, stream, isInvalidated: (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated };
}

describe("LiveUpdatesProvider", () => {
  it("catches up after a gap without moving the orders table, and tells it rows may have changed", async () => {
    const { live, stream, isInvalidated } = setup();
    const first = await stream(0);
    act(() => {
      first.open();
    });
    expect(isInvalidated(metricsKey)).toBe(false); // a first opening has nothing to catch up on

    act(() => {
      first.drop();
    });
    const second = await stream(1);
    act(() => {
      second.open();
    });
    expect(isInvalidated(metricsKey)).toBe(true);
    expect(isInvalidated(listKey)).toBe(false);
    expect(live.current?.changes.caughtUpAt).toBe(live.current?.changes.latest);
    expect(live.current?.changes.caughtUpAt).toBeGreaterThan(0);
  });

  it("skips a garbled event, and keeps listening", async () => {
    const { live, stream } = setup();
    const connection = await stream(0);
    act(() => {
      connection.open();
    });
    expect(() => {
      connection.send({ type: "ordersChanged", data: "{not json", id: null });
    }).not.toThrow();
    act(() => {
      connection.send({ type: "ordersChanged", data: JSON.stringify({ eventSlugs: ["lakeside-lights"] }), id: null });
    });
    await waitFor(() => {
      expect(live.current?.changes.byEvent["lakeside-lights"]).toBe(1);
    });
    expect(streams).toHaveLength(1);
  });
});
