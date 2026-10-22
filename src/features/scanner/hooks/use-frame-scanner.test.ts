import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QrReader } from "@/lib/qr-reader";
import { useFrameScanner } from "./use-frame-scanner";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reading the camera's frames", () => {
  const video = { current: { readyState: HTMLMediaElement.HAVE_ENOUGH_DATA } as HTMLVideoElement };
  const reader: QrReader = { kind: "wasm", read: () => Promise.resolve("ao1.demo-2026.code.sig") };

  it("calls back once for a code that stays in view, and again for a new event", async () => {
    const onCode = vi.fn();
    const { rerender } = renderHook(({ event }) => useFrameScanner(video, reader, onCode, event), {
      initialProps: { event: "open-studio-ceramics" },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onCode).toHaveBeenCalledTimes(1);

    rerender({ event: "monsoon-strings" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onCode).toHaveBeenCalledTimes(2);
  });

  it("reads nothing without a reader", async () => {
    const onCode = vi.fn();
    renderHook(() => useFrameScanner(video, null, onCode));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onCode).not.toHaveBeenCalled();
  });
});
