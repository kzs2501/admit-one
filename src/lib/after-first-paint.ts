/**
 * Resolves just after the browser's next paint: a frame (`requestAnimationFrame` runs
 * just before one), then a task, which runs after it. Work started then can't hold up
 * that paint, nor be counted against it. A hidden page has no paint to protect, and
 * runs no frames, so it resolves at once.
 */
export function afterFirstPaint(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
