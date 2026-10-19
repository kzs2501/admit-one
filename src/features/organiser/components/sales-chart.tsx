import { useId } from "react";
import type { SalesMetricsDto } from "@/contract/dto";
import { formatCount, formatMoney, formatShortDate } from "@/lib/format";
import { areaPaths, niceScale, summarise } from "@/features/organiser/domain/chart";

const PLOT = { width: 640, height: 180 };

/**
 * Tickets sold by day, as an area chart. It's an image with a text summary for anyone
 * who can't see it (W3C WAI, "Complex images"), and the full numbers are a table one
 * click away. The colour isn't the only signal: the line and its gridlines carry it too.
 */
export function SalesChart({ metrics }: { metrics: SalesMetricsDto }) {
  const summaryId = useId();
  const days = metrics.salesByDay;
  const { total, busiest } = summarise(days, (day) => day.tickets);
  const scale = niceScale(busiest?.tickets ?? 0);
  const { line, area } = areaPaths(
    days.map((day) => day.tickets),
    PLOT,
    scale.max,
  );
  const first = days[0];
  const last = days.at(-1);
  const summary =
    first && last && busiest
      ? `${formatCount(total)} tickets sold from ${formatShortDate(first.date)} to ${formatShortDate(last.date)}. The busiest day was ${formatShortDate(busiest.date)}, with ${formatCount(busiest.tickets)}.`
      : "No sales yet.";

  return (
    <figure className="rounded-xl border border-line bg-card p-5">
      <figcaption>
        <h2 className="font-display text-lg font-semibold">Tickets sold by day</h2>
        <p id={summaryId} className="mt-1 text-sm text-ink-2">
          {summary}
        </p>
      </figcaption>
      {/* The plot stretches to fit; its lines don't (non-scaling strokes), and its labels are
          HTML, so text stays readable at any width. */}
      <div className="relative mt-4 h-48 pl-12">
        <div aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute left-0 w-10 -translate-y-1/2 text-right text-xs text-ink-3 tabular-nums"
              style={{ top: `${String(100 - (tick / scale.max) * 100)}%` }}
            >
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <svg
          role="img"
          aria-labelledby={summaryId}
          viewBox={`0 0 ${String(PLOT.width)} ${String(PLOT.height)}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          {scale.ticks.map((tick) => {
            const y = PLOT.height - (tick / scale.max) * PLOT.height;
            return (
              <line
                key={tick}
                x1={0}
                x2={PLOT.width}
                y1={y}
                y2={y}
                className="stroke-line"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path d={area} className="fill-accent/15" />
          <path
            d={line}
            className="fill-none stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {first && last && (
        <div aria-hidden="true" className="mt-1 flex justify-between pl-12 text-xs text-ink-3">
          <span>{formatShortDate(first.date)}</span>
          <span>{formatShortDate(last.date)}</span>
        </div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">Show the numbers</summary>
        <div
          tabIndex={0}
          aria-label="Sales by day"
          className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line"
        >
          <table className="w-full text-left">
            <caption className="sr-only">Tickets sold and revenue, by day</caption>
            <thead className="sticky top-0 bg-sunk text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Tickets
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {days.map((day) => (
                <tr key={day.date} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 font-normal">
                    {formatShortDate(day.date)}
                  </th>
                  <td className="px-3 py-1.5 text-right">{formatCount(day.tickets)}</td>
                  <td className="px-3 py-1.5 text-right">{formatMoney(day.revenueMinor, metrics.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
