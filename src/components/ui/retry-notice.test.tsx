import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryNotice } from "./retry-notice";

describe("RetryNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse("2026-10-19T10:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the wait once in words, counts it down for eyes, and hands back at zero", () => {
    const onReady = vi.fn();
    render(<RetryNotice retryAtMs={Date.now() + 13_000} onReady={onReady} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("You can try again in 13 seconds.");
    expect(notice).toHaveTextContent("0:13");

    // The clock ticks just after each second boundary, so 5.1 s in, it reads 0:08.
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(notice).toHaveTextContent("0:08");
    expect(notice).toHaveTextContent("You can try again in 13 seconds."); // not re-announced each second
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(onReady).toHaveBeenCalledOnce();
  });
});
