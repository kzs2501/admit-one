"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, problemOf } from "@/lib/api-client";
import { patchHoldDetails } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/form-actions";
import { Notice } from "@/components/ui/notice";
import type { StepProps } from "./step-props";

/** Check everything, then create (or update) the order the payment will be for. */
export function ReviewStep({ context, goNext, goBack, onExpired }: StepProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { draft, event, hold } = context;
  const chosenExtras = Object.entries(draft.addOns).filter(([, quantity]) => quantity > 0);

  const save = useMutation({
    mutationFn: () => apiClient.upsertOrder({ holdId: hold.id, attendees: draft.attendees, addOns: draft.addOns }),
    onSuccess: (order) => {
      patchHoldDetails(queryClient, hold.id, (cached) => ({
        ...cached,
        order,
        hold: { ...cached.hold, orderId: order.id },
      }));
      goNext();
    },
    onError: (error) => {
      const problem = problemOf(error);
      switch (problem?.code) {
        case "hold_expired":
          onExpired();
          break;
        case "payment_in_progress":
        case "already_completed":
          if (context.order) router.push(routes.order(context.order.id));
          break;
        default:
          break; // shown in the notice below
      }
    },
  });

  return (
    <div className="space-y-5">
      <section aria-labelledby="who-title" className="rounded-xl border border-line bg-card p-5">
        <h2 id="who-title" className="text-sm font-medium">
          Attendees
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {draft.attendees.map((attendee, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-x-4">
              <span>{attendee.name}</span>
              <span className="text-ink-2">{attendee.email}</span>
            </li>
          ))}
        </ul>
      </section>

      {event.addOns.length > 0 && (
        <section aria-labelledby="extras-title" className="rounded-xl border border-line bg-card p-5">
          <h2 id="extras-title" className="text-sm font-medium">
            Extras
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            {chosenExtras.length
              ? chosenExtras
                  .map(([addOnId, quantity]) => {
                    const name = event.addOns.find((addOn) => addOn.id === addOnId)?.name ?? addOnId;
                    return `${quantity} × ${name}`;
                  })
                  .join(", ")
              : "None"}
          </p>
        </section>
      )}

      {save.isError && problemOf(save.error)?.code !== "hold_expired" && (
        <Notice tone="bad" title="Couldn’t save your order" role="alert">
          {save.error.message}
        </Notice>
      )}

      <FormActions onBack={goBack}>
        <Button type="button" onClick={() => save.mutate()} isBusy={save.isPending}>
          {save.isPending ? "Saving…" : "Continue to payment"}
        </Button>
      </FormActions>
    </div>
  );
}
