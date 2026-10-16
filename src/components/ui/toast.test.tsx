import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast, Toaster } from "./toast";

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    // Let any toast expire while its Toaster is still mounted, so tests can't leak into each other.
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    vi.useRealTimers();
  });

  it("announces a toast in a polite live region that's there before it is", () => {
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    act(() => {
      showToast("Couldn’t refresh", "Check your connection.");
    });
    expect(region).toHaveTextContent("Couldn’t refresh");
    expect(region).toHaveTextContent("Check your connection.");
  });

  it("goes away on its own, or when dismissed", async () => {
    render(<Toaster />);
    act(() => {
      showToast("First", "One");
    });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => {
      showToast("Second", "Two");
    });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("restarts the timer when the same message comes again", () => {
    render(<Toaster />);
    act(() => {
      showToast("Couldn’t refresh", "Offline.");
    });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    act(() => {
      showToast("Couldn’t refresh", "Offline.");
    });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t refresh");
  });
});
