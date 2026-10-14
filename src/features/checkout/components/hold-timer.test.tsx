import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldTimer } from "./hold-timer";

describe("HoldTimer", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-12T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("shows the time left and announces only at thresholds", () => {
    const now = Date.now();
    const onExpire = vi.fn();
    render(<HoldTimer expiresAtMs={now + 122_000} offset={0} onExpire={onExpire} />);
    expect(screen.getByText("2:02")).toBeInTheDocument();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("");

    act(() => vi.advanceTimersByTime(1_000));
    expect(live).toHaveTextContent(""); // 2:01 — nothing to say yet

    act(() => vi.advanceTimersByTime(2_000));
    expect(live).toHaveTextContent("2 minutes left to complete your order.");

    act(() => vi.advanceTimersByTime(30_000));
    expect(live).toHaveTextContent("2 minutes left to complete your order."); // no chatter in between
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("after a backgrounded stretch, announces the time actually left", () => {
    const now = Date.now();
    render(<HoldTimer expiresAtMs={now + 130_000} offset={0} onExpire={vi.fn()} />);
    const live = screen.getByRole("status");
    // The tab sleeps: the clock moves on but no timers fire until it wakes.
    vi.setSystemTime(now + 115_000);
    act(() => vi.advanceTimersByTime(1_005));
    expect(live).toHaveTextContent(/^1\d seconds left to complete your order\.$/);
  });

  it("calls onExpire exactly once when time runs out", () => {
    const onExpire = vi.fn();
    render(<HoldTimer expiresAtMs={Date.now() + 2_000} offset={0} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("applies the server clock offset", () => {
    render(<HoldTimer expiresAtMs={Date.now() + 60_000} offset={20_000} onExpire={() => {}} />);
    expect(screen.getByText("0:40")).toBeInTheDocument();
  });
});
