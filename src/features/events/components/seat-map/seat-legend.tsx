import type { ReactNode } from "react";
import type { TierTone } from "@/features/events/domain/tier-tones";
import { SeatGlyph, TONE_FILLS, type SeatCellState } from "./seat-cell";

export interface TierKey {
  id: string;
  name: string;
  price: string;
  /** Where in the hall, in words: "Stalls rows A–F, closest to the orchestra." */
  description: string;
  tone: TierTone;
}

// A free seat takes its tier's colour, so the key for "free" shows all three.
const ANY_TIER = "bg-[linear-gradient(90deg,var(--tier-1)_33%,var(--tier-2)_33%_66%,var(--tier-3)_66%)]";

const STATES: { state: SeatCellState; isWheelchairSpace: boolean; label: string; className: string }[] = [
  { state: "free", isWheelchairSpace: false, label: "Available", className: `border-ink-3 ${ANY_TIER} text-tier-ink` },
  {
    state: "selected",
    isWheelchairSpace: false,
    label: "Your choice",
    className: "border-chosen bg-chosen text-chosen-ink",
  },
  { state: "taken", isWheelchairSpace: false, label: "Taken", className: "border-transparent bg-sunk text-ink-3" },
  {
    state: "free",
    isWheelchairSpace: true,
    label: "Wheelchair space",
    className: `border-ink-3 ${ANY_TIER} text-tier-ink`,
  },
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
 * each price tier is described in words; its colour only repeats that.
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
            <Swatch className={`border-ink-3 ${TONE_FILLS[tier.tone]}`} />
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
