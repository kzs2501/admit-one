"use client";

import { useEffect, useMemo } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ticketCount } from "@/core/money";
import { attendeesSchema } from "@/core/schemas";
import { Button } from "@/components/ui/button";
import type { StepProps } from "./step-props";

/** One name and email per ticket: tickets are personal, so each needs its own. */
export function AttendeesStep({ ctx, draft, updateDraft, goNext }: StepProps) {
  const { hold, event } = ctx;
  const count = ticketCount(hold.items);

  // "Ticket 2 · Workshop + General" — one label per ticket, in order.
  const labels = useMemo(
    () =>
      hold.items.flatMap(({ tierId, qty }) =>
        Array.from({ length: qty }, () => event.tiers.find((t) => t.id === tierId)?.name ?? "Ticket"),
      ),
    [hold.items, event.tiers],
  );

  const schema = useMemo(() => z.object({ attendees: attendeesSchema(count) }), [count]);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      attendees: Array.from({ length: count }, (_, i) => draft.attendees[i] ?? { name: "", email: "" }),
    },
    mode: "onTouched", // validate after the first blur — not on every keystroke, not only on submit
  });
  const { fields } = useFieldArray({ control: form.control, name: "attendees" });
  const errors = form.formState.errors.attendees;

  // Save as they type, so a refresh or a step back loses nothing.
  const typed = useWatch({ control: form.control, name: "attendees" });
  useEffect(() => {
    updateDraft({ attendees: (typed ?? []).map((a) => ({ name: a?.name ?? "", email: a?.email ?? "" })) });
  }, [typed, updateDraft]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        updateDraft({ attendees: values.attendees });
        goNext();
      })}
      className="space-y-5"
    >
      {fields.map((field, i) => {
        const err = errors?.[i];
        const nameId = `attendee-${i}-name`;
        const emailId = `attendee-${i}-email`;
        return (
          <fieldset key={field.id} className="rounded-xl border border-line bg-card p-5">
            <legend className="px-1 text-sm font-medium">
              Ticket {i + 1} <span className="font-normal text-ink-3">· {labels[i]}</span>
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={nameId} className="block text-sm text-ink-2">
                  Full name
                </label>
                <input
                  id={nameId}
                  autoComplete={i === 0 ? "name" : "off"}
                  aria-invalid={err?.name ? true : undefined}
                  aria-describedby={err?.name ? `${nameId}-error` : undefined}
                  {...form.register(`attendees.${i}.name`)}
                  className="mt-1.5 h-11 w-full rounded-lg border border-line bg-paper px-3 text-base aria-[invalid=true]:border-bad"
                />
                {err?.name && (
                  <p id={`${nameId}-error`} className="mt-1.5 text-sm text-bad">
                    {err.name.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={emailId} className="block text-sm text-ink-2">
                  Email <span className="text-ink-3">(the ticket is sent here)</span>
                </label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  spellCheck={false}
                  autoComplete={i === 0 ? "email" : "off"}
                  aria-invalid={err?.email ? true : undefined}
                  aria-describedby={err?.email ? `${emailId}-error` : undefined}
                  {...form.register(`attendees.${i}.email`)}
                  className="mt-1.5 h-11 w-full rounded-lg border border-line bg-paper px-3 text-base aria-[invalid=true]:border-bad"
                />
                {err?.email && (
                  <p id={`${emailId}-error`} className="mt-1.5 text-sm text-bad">
                    {err.email.message}
                  </p>
                )}
              </div>
            </div>
          </fieldset>
        );
      })}
      <div className="flex justify-end">
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}
