import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./error-boundary";

function Broken(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing goes wrong", () => {
    render(
      <ErrorBoundary fallback={<p>Fallback</p>}>
        <p>Content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.queryByText("Fallback")).not.toBeInTheDocument();
  });

  it("swaps a crashed part for its fallback, keeps its siblings, and reports the error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <>
        <ErrorBoundary fallback={<p>Fallback</p>}>
          <Broken />
        </ErrorBoundary>
        <p>Sibling</p>
      </>,
    );
    expect(screen.getByText("Fallback")).toBeInTheDocument();
    expect(screen.getByText("Sibling")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "[component]",
      expect.objectContaining({ message: "render failed" }),
      expect.objectContaining({ source: "component" }),
    );
  });
});
