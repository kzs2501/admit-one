"use client";

import { ticketCount } from "@/core/ticketing";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/form-actions";
import { Stepper } from "@/components/ui/stepper";
import type { StepProps } from "./step-props";

/** Optional extras, up to one of each per ticket. Only shown for events that have any. */
export function AddOnsStep({ context, updateDraft, goNext, goBack }: StepProps) {
  const { draft } = context;
  const count = ticketCount(context.hold.items);
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-line rounded-xl border border-line bg-card">
        {context.event.addOns.map((addOn) => (
          <li key={addOn.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium">{addOn.name}</p>
              <p className="text-sm text-ink-2">{addOn.description}</p>
              <p className="tabular mt-1 text-sm">{formatMoney(addOn.priceMinor, context.event.currency)} each</p>
            </div>
            <Stepper
              label={addOn.name}
              value={draft.addOns[addOn.id] ?? 0}
              max={count}
              onChange={(quantity) => updateDraft({ addOns: { ...draft.addOns, [addOn.id]: quantity } })}
            />
          </li>
        ))}
      </ul>
      <FormActions onBack={goBack}>
        <Button
          type="button"
          onClick={() => {
            updateDraft({ hasConfirmedAddOns: true });
            goNext();
          }}
        >
          {Object.values(draft.addOns).some((quantity) => quantity > 0) ? "Continue" : "Continue without extras"}
        </Button>
      </FormActions>
    </div>
  );
}
