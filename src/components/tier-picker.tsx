"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_TICKETS_PER_ORDER } from "@/shared/catalog";
import type { HoldResponse } from "@/shared/api-types";
import { formatMoney } from "@/shared/money";
import { api, ApiError } from "@/lib/api";
import { stepHref } from "@/checkout/registry";
import { Button, Notice, Stepper } from "./ui";

/** Choose tickets and reserve them. Availability is live: it can change while you look. */
export function TierPicker({ slug }: { slug: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: event, isPending, isError, refetch } = useQuery({
    queryKey: ["event", slug],
    queryFn: () => api.getEvent(slug),
    refetchInterval: 5_000,
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [lostRace, setLostRace] = useState<string | null>(null);

  const reserve = useMutation({
    mutationFn: () =>
      api.createHold(
        slug,
        Object.entries(qty)
          .filter(([, n]) => n > 0)
          .map(([tierId, n]) => ({ tierId, qty: n })),
      ),
    onSuccess: (res: HoldResponse) => {
      // Seed the checkout's cache so it renders instantly, no second round-trip.
      queryClient.setQueryData(["hold", res.hold.id], res);
      router.push(stepHref(res.hold.id, "attendees"));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "sold_out") {
        const tierId = String(error.details.tierId ?? "");
        const left = Number(error.details.available ?? 0);
        setQty((q) => ({ ...q, [tierId]: Math.min(q[tierId] ?? 0, left) }));
        setLostRace(left === 0 ? "Someone just got the last of those tickets." : `Someone got there first — only ${left} left now.`);
        refetch();
      }
    },
  });

  if (isPending) {
    return <div aria-busy="true" aria-label="Loading tickets" className="h-56 rounded-xl border border-line bg-card" />;
  }
  if (isError || !event) {
    return (
      <Notice tone="bad" title="Couldn’t load tickets" role="alert">
        <button className="underline underline-offset-4" onClick={() => refetch()}>
          Try again
        </button>
      </Notice>
    );
  }

  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const subtotal = event.tiers.reduce((sum, t) => sum + t.priceCents * (qty[t.id] ?? 0), 0);
  const soldOut = event.tiers.every((t) => t.available === 0);

  return (
    <form
      className="rounded-xl border border-line bg-card"
      onSubmit={(e) => {
        e.preventDefault();
        setLostRace(null);
        reserve.mutate();
      }}
    >
      <ul className="divide-y divide-line">
        {event.tiers.map((tier) => {
          const mine = qty[tier.id] ?? 0;
          const max = Math.min(tier.available, MAX_TICKETS_PER_ORDER - (total - mine));
          return (
            <li key={tier.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-medium">{tier.name}</p>
                <p className="text-sm text-ink-2">{tier.description}</p>
                <p className="mt-1 text-sm">
                  <span className="tabular font-medium">{formatMoney(tier.priceCents)}</span>
                  <span className={`ml-2 tabular text-xs ${tier.available === 0 ? "text-bad" : tier.available <= 5 ? "text-warn" : "text-ink-3"}`}>
                    {tier.available === 0 ? "Sold out" : `${tier.available} left`}
                  </span>
                </p>
              </div>
              <Stepper
                label={tier.name}
                value={mine}
                max={Math.max(0, max)}
                onChange={(n) => setQty((q) => ({ ...q, [tier.id]: n }))}
                disabled={tier.available === 0 || reserve.isPending}
              />
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-line p-5">
        {lostRace && (
          <Notice tone="warn" title="Just missed it" role="alert">
            {lostRace} The numbers above are up to date.
          </Notice>
        )}
        {reserve.isError && !lostRace && (
          <Notice tone="bad" title="Couldn’t reserve those tickets" role="alert">
            {reserve.error.message}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2" aria-live="polite">
            {total === 0 ? (
              soldOut ? "This event is sold out." : `Choose up to ${MAX_TICKETS_PER_ORDER} tickets.`
            ) : (
              <>
                {total} ticket{total === 1 ? "" : "s"} · <span className="tabular font-medium text-ink">{formatMoney(subtotal)}</span>
              </>
            )}
          </p>
          <Button type="submit" disabled={total === 0 || soldOut} busy={reserve.isPending}>
            {soldOut ? "Sold out" : reserve.isPending ? "Reserving…" : "Reserve tickets"}
          </Button>
        </div>
        {!soldOut && <p className="text-xs text-ink-3">We’ll hold them for you while you check out.</p>}
      </div>
    </form>
  );
}
