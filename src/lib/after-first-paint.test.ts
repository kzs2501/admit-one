import { afterEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint } from "./after-first-paint";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("afterFirstPaint", () => {
  it("waits for a frame, then a task after it", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "setTimeout"] });
    let isDone = false;
    void afterFirstPaint().then(() => {
      isDone = true;
    });
    await vi.advanceTimersToNextTimerAsync();
    // The frame has run, not yet the task after it.
    expect(isDone).toBe(false);
    await vi.advanceTimersToNextTimerAsync();
    expect(isDone).toBe(true);
  });

  it("doesn't wait in a hidden page, which runs no frames", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const frame = vi.spyOn(window, "requestAnimationFrame");
    await afterFirstPaint();
    expect(frame).not.toHaveBeenCalled();
  });
});
