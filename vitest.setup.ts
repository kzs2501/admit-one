import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom doesn't lay anything out, so it has no scrollIntoView; real browsers (and the
// e2e tests) do the scrolling. Node-environment test files have no DOM at all.
if ("Element" in globalThis) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // Nothing to scroll in jsdom.
  };
}
