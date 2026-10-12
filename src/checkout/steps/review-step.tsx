"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HoldResponse } from "@/shared/api-types";
import { api, ApiError } from "@/lib/api";
import { Button, Notice } from "@/components/ui";
import type { StepProps } from "./types";

/** Check everything, then create (or update) the order the payment will be for. */
export function ReviewStep({ ctx, holdId, draft, goNext, goBack, onExpired }: StepProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const extras = Object.entries(draft.addOns).filter(([, n]) => n > 0);

  const save = useMutation({
    mutationFn: () => api.upsertOrder(holdId, draft.attendees, draft.addOns),
    onSuccess: (order) => {
      queryClient.setQueryData<HoldResponse>(["hold", holdId], (old) => (old ? { ...old, order, hold: { ...old.hold, orderId: order.id } } : old));
      goNext();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 410) onExpired();
      if (error instanceof ApiError && (error.code === "payment_in_progress" || error.code === "already_completed") && ctx.order) {
        router.push(`/orders/${ctx.order.id}`);
      }
    },
  });

  return (
    <div className="space-y-5">
      <section aria-labelledby="who-title" className="rounded-xl border border-line bg-card p-5">
        <h3 id="who-title" className="text-sm font-medium">
          Attendees
        </h3>
        <ul className="mt-3 space-y-2 text-sm">
          {draft.attendees.map((a, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-x-4">
              <span>{a.name}</span>
              <span className="text-ink-2">{a.email}</span>
            </li>
          ))}
        </ul>
      </section>

      {ctx.event.addOns.length > 0 && (
        <section aria-labelledby="extras-title" className="rounded-xl border border-line bg-card p-5">
          <h3 id="extras-title" className="text-sm font-medium">
            Extras
          </h3>
          <p className="mt-2 text-sm text-ink-2">
            {extras.length
              ? extras.map(([id, n]) => `${n} × ${ctx.event.addOns.find((a) => a.id === id)?.name}`).join(", ")
              : "None"}
          </p>
        </section>
      )}

      {save.isError && !(save.error instanceof ApiError && save.error.status === 410) && (
        <Notice tone="bad" title="Couldn’t save your order" role="alert">
          {save.error.message}
        </Notice>
      )}

      <div className="flex justify-between gap-3">
        {goBack ? (
          <Button type="button" variant="ghost" onClick={goBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={() => save.mutate()} busy={save.isPending}>
          {save.isPending ? "Saving…" : "Continue to payment"}
        </Button>
      </div>
    </div>
  );
}
