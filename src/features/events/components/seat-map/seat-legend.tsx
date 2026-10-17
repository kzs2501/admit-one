import type { ReactNode } from "react";
import { SeatGlyph, type SeatCellState } from "./seat-cell";

export interface TierKey {
  id: string;
  name: string;
  price: string;
  /** Where in the hall, in words: "Stalls rows A–F, closest to the orchestra." */
  description: string;
  isFeatured: boolean;
}

const STATES: { state: SeatCellState; isWheelchairSpace: boolean; label: string; className: string }[] = [
  { state: "free", isWheelchairSpace: false, label: "Available", className: "border-ink-3 bg-card text-ink-3" },
  {
    state: "selected",
    isWheelchairSpace: false,
    label: "Your choice",
    className: "border-accent bg-accent text-accent-ink",
  },
  { state: "taken", isWheelchairSpace: false, label: "Taken", className: "border-transparent bg-sunk text-ink-3" },
  { state: "free", isWheelchairSpace: true, label: "Wheelchair space", className: "border-ink-3 bg-card text-ink-3" },
];

const Swatch = ({ className, children }: { className: string; children?: ReactNode }) => (
  <span
    aria-hidden="true"
    className={`grid size-6 shrink-0 place-items-center rounded-t-md rounded-b-sm border-2 ${className}`}
  >
    {children}
  </span>
);

/**
 * What the map means. Each seat state has its own shape as well as its own colour, and
 * each price tier is described in words — the tint on the top tier only repeats it.
 */
export function SeatLegend({ tiers }: { tiers: readonly TierKey[] }) {
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <ul aria-label="Seats" className="flex flex-wrap gap-x-5 gap-y-2">
        {STATES.map((entry) => (
          <li key={entry.label} className="flex items-center gap-2">
            <Swatch className={entry.className}>
              <SeatGlyph state={entry.state} isWheelchairSpace={entry.isWheelchairSpace} />
            </Swatch>
            {entry.label}
          </li>
        ))}
      </ul>
      <ul aria-label="Prices" className="flex flex-wrap gap-x-5 gap-y-2">
        {tiers.map((tier) => (
          <li key={tier.id} className="flex items-center gap-2">
            <Swatch className={`border-ink-3 ${tier.isFeatured ? "bg-accent-soft" : "bg-card"}`} />
            <span>
              <span className="font-medium text-ink">{tier.name}</span> <span className="tabular">{tier.price}</span>
              <span className="text-ink-3"> · {tier.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
