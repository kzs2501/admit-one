"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** "12 left" / "Almost gone" / "Sold out" — live, while the static card renders instantly. */
export function AvailabilityBadge({ slug }: { slug: string }) {
  const { data } = useQuery({ queryKey: ["events"], queryFn: api.listEvents, refetchInterval: 8_000 });
  const event = data?.find((e) => e.slug === slug);

  // Reserve the badge's space before data arrives, so nothing shifts when it does.
  if (!event) return <span aria-hidden="true" className="inline-block h-6 w-20 shrink-0 rounded-full bg-sunk" />;

  const left = event.tiers.reduce((n, t) => n + t.available, 0);
  const capacity = event.tiers.reduce((n, t) => n + t.capacity, 0);
  const tone =
    left === 0 ? "bg-bad-soft text-bad" : left / capacity <= 0.1 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok";
  return (
    <span
      className={`tabular inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {left === 0 ? "Sold out" : left <= 5 ? `Only ${left} left` : `${left} left`}
    </span>
  );
}
