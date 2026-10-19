import { describe, expect, it } from "vitest";
import { areaPaths, niceScale, plotPoints, summarise } from "./chart";

describe("niceScale", () => {
  it.each([
    [2031, 2500, 500],
    [73, 80, 20],
    [9, 10, 2],
    [1, 1, 1],
  ])("tops %i at %i in steps of %i", (largest, max, step) => {
    const scale = niceScale(largest);
    expect(scale.max).toBe(max);
    expect(scale.ticks[1]).toBe(step);
    expect(scale.ticks.at(-1)).toBe(max);
    expect(scale.max).toBeGreaterThanOrEqual(largest);
  });

  it("still draws an axis when there's nothing to show", () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});

describe("area chart", () => {
  const plot = { width: 300, height: 100 };

  it("spaces values evenly and scales them up from the bottom", () => {
    expect(plotPoints([0, 50, 100], plot, 100)).toEqual([
      { x: 0, y: 100 },
      { x: 150, y: 50 },
      { x: 300, y: 0 },
    ]);
  });

  it("closes the area down to the axis", () => {
    const { line, area } = areaPaths([0, 100], plot, 100);
    expect(line).toBe("M0 100L300 0");
    expect(area).toBe("M0 100L300 0L300 100L0 100Z");
    expect(areaPaths([], plot, 100)).toEqual({ line: "", area: "" });
  });
});

describe("summarise", () => {
  it("finds the total and the busiest entry", () => {
    const days = [
      { date: "a", tickets: 3 },
      { date: "b", tickets: 9 },
      { date: "c", tickets: 9 },
    ];
    expect(summarise(days, (day) => day.tickets)).toEqual({ total: 21, busiest: days[1] });
  });
});
