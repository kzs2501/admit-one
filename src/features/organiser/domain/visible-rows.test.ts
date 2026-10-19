import { describe, expect, it } from "vitest";
import { spacers, withFocusedRow } from "./visible-rows";

describe("withFocusedRow", () => {
  it("keeps the focused row drawn even when it's out of view", () => {
    expect(withFocusedRow([10, 11, 12], 2)).toEqual([2, 10, 11, 12]);
    expect(withFocusedRow([10, 11, 12], 11)).toEqual([10, 11, 12]);
    expect(withFocusedRow([10, 11, 12], null)).toEqual([10, 11, 12]);
  });
});

describe("spacers", () => {
  it("fills the space above, between and below the drawn rows", () => {
    const row = (index: number) => ({ index, start: index * 50, end: index * 50 + 50 });
    expect(spacers([row(2), row(10), row(11)], 1_000)).toEqual([
      { beforeIndex: 2, height: 100 },
      { beforeIndex: 10, height: 350 },
      { beforeIndex: null, height: 400 },
    ]);
    expect(spacers([row(0), row(1)], 100)).toEqual([]);
  });
});
