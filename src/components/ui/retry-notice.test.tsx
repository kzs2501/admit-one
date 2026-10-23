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
    const { container } = render(<RetryNotice retryAtMs={Date.now() + 13_000} onReady={onReady} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Too many attempts. To keep the sale fair, reserving is limited.");
    expect(region).toHaveTextContent("You can try again in 13 seconds.");
    expect(region).not.toHaveTextContent("0:13");
    expect(container).toHaveTextContent("0:13");

    // The clock ticks just after each second boundary, so 5.1 s in, it reads 0:08.
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(container).toHaveTextContent("0:08");
    expect(region).toHaveTextContent("You can try again in 13 seconds."); // not re-announced each second
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("is a status region before there's a wait, so the wait is heard when it comes", () => {
    const { rerender } = render(<RetryNotice retryAtMs={null} onReady={vi.fn()} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByText("Too many attempts")).toBeNull();

    rerender(<RetryNotice retryAtMs={Date.now() + 20_000} onReady={vi.fn()} />);
    // The same node, now with words in it: that's a change a screen reader reads out.
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("You can try again in 20 seconds.");

    rerender(<RetryNotice retryAtMs={null} onReady={vi.fn()} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });
});
