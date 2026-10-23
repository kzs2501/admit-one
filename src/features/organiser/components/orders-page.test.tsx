import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ORDER_SEARCH_LENGTH } from "@/contract/queries";
import { SearchBox } from "./orders-page";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const type = (text: string) => {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
};

describe("SearchBox", () => {
  it("doesn't search again for a space at the end", () => {
    const onSearch = vi.fn();
    render(<SearchBox value="asha" onSearch={onSearch} />);
    type("asha ");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("searches after a pause in typing, however often the page re-renders meanwhile", () => {
    const first = vi.fn();
    const { rerender } = render(<SearchBox value="" onSearch={first} />);
    type("asha");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // The page re-renders, as it does when the list updates, with a new callback.
    const second = vi.fn();
    rerender(<SearchBox value="" onSearch={second} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(second).toHaveBeenCalledExactlyOnceWith("asha");
    expect(first).not.toHaveBeenCalled();
  });

  it("takes no more than the API does", () => {
    render(<SearchBox value="" onSearch={vi.fn()} />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxlength", String(MAX_ORDER_SEARCH_LENGTH));
  });
});
