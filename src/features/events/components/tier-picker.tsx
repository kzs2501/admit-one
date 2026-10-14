"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HoldDetailsDto } from "@/contract/dto";
import { MAX_TICKETS_PER_ORDER, stockLevel, type StockLevel } from "@/core/ticketing";
import { apiClient, problemOf } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { stepHref } from "@/features/checkout/domain/step-registry";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Stepper } from "@/components/ui/stepper";

const STOCK_TONES: Record<StockLevel, string> = { "sold-out": "text-bad", low: "text-warn", plenty: "text-ink-3" };

/** Choose tickets and reserve them. Availability is live: it can change while you look. */
export function TierPicker({ slug }: { slug: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: event,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["event", slug],
    queryFn: () => apiClient.getEvent(slug),
    refetchInterval: 5_000,
  });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isSoldOutNotice, setSoldOutNotice] = useState<string | null>(null);

  const reserve = useMutation({
    mutationFn: () =>
      apiClient.createHold({
        eventSlug: slug,
        items: Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([tierId, quantity]) => ({ tierId, quantity })),
      }),
    onSuccess: (details: HoldDetailsDto) => {
      // Seed the checkout's cache so it renders instantly, no second round-trip.
      queryClient.setQueryData(["hold", details.hold.id], details);
      router.push(stepHref(details.hold.id, "attendees"));
    },
    onError: (error) => {
      const problem = problemOf(error);
      if (problem?.code !== "sold_out") return;
      const { tierId, available } = problem;
      setQuantities((current) => ({ ...current, [tierId]: Math.min(current[tierId] ?? 0, available) }));
      setSoldOutNotice(
        available === 0
          ? "Someone just got the last of those tickets."
          : `Someone got there first — only ${available} left now.`,
      );
      void refetch();
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

  const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = event.tiers.reduce((sum, tier) => sum + tier.priceCents * (quantities[tier.id] ?? 0), 0);
  const isSoldOut = event.tiers.every((tier) => tier.available === 0);

  return (
    <form
      className="rounded-xl border border-line bg-card"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        setSoldOutNotice(null);
        reserve.mutate();
      }}
    >
      <ul className="divide-y divide-line">
        {event.tiers.map((tier) => {
          const chosen = quantities[tier.id] ?? 0;
          const max = Math.min(tier.available, MAX_TICKETS_PER_ORDER - (total - chosen));
          const level = stockLevel(tier.available);
          return (
            <li key={tier.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-medium">{tier.name}</p>
                <p className="text-sm text-ink-2">{tier.description}</p>
                <p className="mt-1 text-sm">
                  <span className="tabular font-medium">{formatMoney(tier.priceCents)}</span>
                  <span className={`tabular ml-2 text-xs ${STOCK_TONES[level]}`}>
                    {level === "sold-out" ? "Sold out" : `${tier.available} left`}
                  </span>
                </p>
              </div>
              <Stepper
                label={tier.name}
                value={chosen}
                max={Math.max(0, max)}
                onChange={(quantity) => setQuantities((current) => ({ ...current, [tier.id]: quantity }))}
                disabled={tier.available === 0 || reserve.isPending}
              />
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-line p-5">
        {isSoldOutNotice && (
          <Notice tone="warn" title="Just missed it" role="alert">
            {isSoldOutNotice} The numbers above are up to date.
          </Notice>
        )}
        {reserve.isError && !isSoldOutNotice && (
          <Notice tone="bad" title="Couldn’t reserve those tickets" role="alert">
            {reserve.error.message}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2" aria-live="polite">
            {total === 0 ? (
              isSoldOut ? (
                "This event is sold out."
              ) : (
                `Choose up to ${MAX_TICKETS_PER_ORDER} tickets.`
              )
            ) : (
              <>
                {total} ticket{total === 1 ? "" : "s"} ·{" "}
                <span className="tabular font-medium text-ink">{formatMoney(subtotal)}</span>
              </>
            )}
          </p>
          <Button type="submit" disabled={total === 0 || isSoldOut} busy={reserve.isPending}>
            {isSoldOut ? "Sold out" : reserve.isPending ? "Reserving…" : "Reserve tickets"}
          </Button>
        </div>
        {!isSoldOut && <p className="text-xs text-ink-3">We’ll hold them for you while you check out.</p>}
      </div>
    </form>
  );
}
