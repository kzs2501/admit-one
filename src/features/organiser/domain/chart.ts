/**
 * Chart geometry, as pure functions: a scale with round numbers, and the path of an
 * area chart. The SVG components only draw what these return, so the arithmetic is
 * tested without a browser.
 */

export interface Scale {
  /** The top of the axis: at or above the largest value, on a round number. */
  max: number;
  ticks: number[];
}

/**
 * A step of 1, 2 or 5 times a power of ten — the steps people read without effort —
 * rounded to the nearest (Heckbert, "Nice numbers for graph labels", 1990), so the
 * axis isn't left mostly empty.
 */
function niceStep(rough: number) {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  return (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * power;
}

/** About `tickCount` gridlines from zero to a round number at or above `largest`. */
export function niceScale(largest: number, tickCount = 4): Scale {
  if (largest <= 0) return { max: 1, ticks: [0, 1] };
  const step = Math.max(1, niceStep(largest / tickCount));
  const max = Math.ceil(largest / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}

export interface Plot {
  width: number;
  height: number;
}

/** Where each value sits in the plot: evenly spaced across, scaled up from the bottom. */
export function plotPoints(values: readonly number[], plot: Plot, max: number) {
  const across = values.length > 1 ? plot.width / (values.length - 1) : 0;
  return values.map((value, i) => ({ x: i * across, y: plot.height - (Math.min(value, max) / max) * plot.height }));
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The line through the points, and the area under it down to the axis. */
export function areaPaths(values: readonly number[], plot: Plot, max: number) {
  const points = plotPoints(values, plot, max);
  const line = points.map(({ x, y }, i) => `${i ? "L" : "M"}${String(round(x))} ${String(round(y))}`).join("");
  const last = points.at(-1);
  const area = last ? `${line}L${String(round(last.x))} ${String(plot.height)}L0 ${String(plot.height)}Z` : "";
  return { line, area };
}

/** The busiest entry, and the total: the two things a sales chart's summary says. */
export function summarise<T>(entries: readonly T[], valueOf: (entry: T) => number) {
  let busiest: T | undefined;
  let total = 0;
  for (const entry of entries) {
    const value = valueOf(entry);
    total += value;
    if (busiest === undefined || value > valueOf(busiest)) busiest = entry;
  }
  return { total, busiest };
}
