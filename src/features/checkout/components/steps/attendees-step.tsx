"use client";

import { useEffect, useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@/core/zod";
import { attendeesSchema } from "@/core/schemas";
import { ticketCount } from "@/core/ticketing";
import { formatSeat } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import type { StepProps } from "./step-props";

/** One name and email per ticket: tickets are personal, so each needs its own. */
export function AttendeesStep({ context, updateDraft, goNext }: StepProps) {
  const { hold, event, draft } = context;
  const count = ticketCount(hold.items);

  // One label per ticket, in the order tickets are issued: "Ticket 2 · Workshop + General",
  // or with reserved seating, "Ticket 2 · Stalls, row F, seat 13 · Premium".
  const ticketLabels = useMemo(() => {
    const tierName = (tierId: string) => event.tiers.find((tier) => tier.id === tierId)?.name ?? "Ticket";
    return hold.seats.length > 0
      ? hold.seats.map((seat) => {
          // "Balcony, row A, seat 16" already says Balcony; only add a tier that says more.
          const tier = tierName(seat.tierId);
          return tier === seat.sectionName ? formatSeat(seat) : `${formatSeat(seat)} · ${tier}`;
        })
      : hold.items.flatMap(({ tierId, quantity }) => Array.from({ length: quantity }, () => tierName(tierId)));
  }, [hold.items, hold.seats, event.tiers]);

  const schema = useMemo(() => z.object({ attendees: attendeesSchema(count) }), [count]);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      attendees: Array.from({ length: count }, (_, i) => draft.attendees[i] ?? { name: "", email: "" }),
    },
    mode: "onTouched", // validate after the first blur — not on every keystroke, not only on submit
  });
  const { fields } = useFieldArray({ control: form.control, name: "attendees" });
  const errors = form.formState.errors.attendees;

  // Save as they type, so a refresh or a step back loses nothing. A subscription, not
  // a render-then-effect: the form's values go straight to the draft store.
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values }) => {
          updateDraft({
            attendees: values.attendees.map((typed) => ({ name: typed.name, email: typed.email })),
          });
        },
      }),
    [form, updateDraft],
  );

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
        const fieldErrors = errors?.[i];
        const isFirstTicket = i === 0;
        return (
          <fieldset key={field.id} className="rounded-xl border border-line bg-card p-5">
            <legend className="px-1 text-sm font-medium">
              Ticket {i + 1} <span className="font-normal text-ink-3">· {ticketLabels[i]}</span>
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id={`attendee-${i}-name`}
                label="Full name"
                error={fieldErrors?.name?.message}
                inputProps={{ autoComplete: isFirstTicket ? "name" : "off", ...form.register(`attendees.${i}.name`) }}
              />
              <TextField
                id={`attendee-${i}-email`}
                label="Email"
                hint="the ticket is sent here"
                error={fieldErrors?.email?.message}
                inputProps={{
                  type: "email",
                  inputMode: "email",
                  spellCheck: false,
                  autoComplete: isFirstTicket ? "email" : "off",
                  ...form.register(`attendees.${i}.email`),
                }}
              />
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
