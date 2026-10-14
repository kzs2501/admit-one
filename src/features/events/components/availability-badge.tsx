"use client";

import { useQuery } from "@tanstack/react-query";
import { stockLevel, type StockLevel } from "@/core/ticketing";
import { eventQueries } from "@/lib/queries";

/** Availability changes while the page is open; refresh it this often. */
const AVAILABILITY_REFRESH_MS = 8_000;

const TONES: Record<StockLevel, string> = {
  "sold-out": "bg-bad-soft text-bad",
  low: "bg-warn-soft text-warn",
  plenty: "bg-ok-soft text-ok",
};

/** "12 left" / "Only 2 left" / "Sold out" — live, while the static card renders instantly. */
export function AvailabilityBadge({ slug }: { slug: string }) {
  const { data } = useQuery({ ...eventQueries.list(), refetchInterval: AVAILABILITY_REFRESH_MS });
  const event = data?.find((candidate) => candidate.slug === slug);

  // Reserve the badge's space before data arrives, so nothing shifts when it does.
  if (!event) return <span aria-hidden="true" className="inline-block h-6 w-20 shrink-0 rounded-full bg-sunk" />;

  const available = event.tiers.reduce((total, tier) => total + tier.available, 0);
  const level = stockLevel(available);
  return (
    <span
      className={`tabular inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${TONES[level]}`}
    >
      {level === "sold-out" ? "Sold out" : level === "low" ? `Only ${available} left` : `${available} left`}
    </span>
  );
}
