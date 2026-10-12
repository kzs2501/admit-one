"use client";

import { ticketCount, formatMoney } from "@/shared/money";
import { Button, Stepper } from "@/components/ui";
import type { StepProps } from "./types";

/** Optional extras, up to one of each per ticket. Only shown for events that have any. */
export function AddOnsStep({ ctx, draft, updateDraft, goNext, goBack }: StepProps) {
  const count = ticketCount(ctx.hold.items);
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-line rounded-xl border border-line bg-card">
        {ctx.event.addOns.map((addOn) => (
          <li key={addOn.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium">{addOn.name}</p>
              <p className="text-sm text-ink-2">{addOn.description}</p>
              <p className="tabular mt-1 text-sm">{formatMoney(addOn.priceCents)} each</p>
            </div>
            <Stepper
              label={addOn.name}
              value={draft.addOns[addOn.id] ?? 0}
              max={count}
              onChange={(n) => updateDraft({ addOns: { ...draft.addOns, [addOn.id]: n } })}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-3">
        {goBack ? (
          <Button type="button" variant="ghost" onClick={goBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          onClick={() => {
            updateDraft({ addOnsConfirmed: true });
            goNext();
          }}
        >
          {Object.values(draft.addOns).some((n) => n > 0) ? "Continue" : "Continue without extras"}
        </Button>
      </div>
    </div>
  );
}
