"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EventDto, HoldDto } from "@/contract/dto";
import { apiClient, problemOf } from "@/lib/api-client";
import { holdQueries } from "@/lib/queries";
import { readQueueToken } from "@/lib/queue-token";
import { routes } from "@/lib/routes";
import { describeItems, formatSeats } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Notice } from "@/components/ui/notice";
import { copyDraft } from "@/features/checkout/hooks/use-draft";
import { stepHref, type StepId } from "@/features/checkout/domain/step-registry";

/**
 * The hold ran out. Offer to reserve the same tickets — or the same seats — again,
 * carrying over everything the buyer already typed, rather than sending them back to
 * the start.
 */
export function ExpiredPanel({
  hold,
  event,
  step,
  headingRef,
}: {
  hold: HoldDto;
  event: EventDto;
  step: StepId;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSeated = hold.seats.length > 0;
  const again = useMutation({
    mutationFn: () =>
      apiClient.createHold(
        isSeated
          ? { eventSlug: hold.eventSlug, seatIds: hold.seats.map((seat) => seat.id) }
          : { eventSlug: hold.eventSlug, items: hold.items },
        readQueueToken(hold.eventSlug),
      ),
    onSuccess: (details) => {
      copyDraft(hold.id, details.hold.id);
      queryClient.setQueryData(holdQueries.detail(details.hold.id).queryKey, details);
      router.replace(stepHref(details.hold.id, step));
    },
  });
  const goneCode = problemOf(again.error)?.code;
  const isGoneAgain = goneCode === "sold_out" || goneCode === "seats_unavailable";

  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">
        Your reservation expired
      </h1>
      <p className="mt-3 text-ink-2">
        We held {isSeated ? formatSeats(hold.seats) : describeItems(event.tiers, hold.items)} for you, but time ran out,
        so they’ve gone back on sale.
      </p>
      <div className="mt-6 space-y-4">
        {isGoneAgain ? (
          <Notice
            tone="bad"
            title={isSeated ? "Some of those seats have gone" : "Those tickets have gone"}
            role="alert"
          >
            Someone else reserved them after your hold expired.{" "}
            <Link href={routes.event(hold.eventSlug)} className="underline underline-offset-4">
              See what’s left
            </Link>
          </Notice>
        ) : (
          again.isError && (
            <Notice tone="bad" title="Couldn’t reserve them again" role="alert">
              {again.error.message}
            </Notice>
          )
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => again.mutate()} isBusy={again.isPending} disabled={isGoneAgain}>
            {again.isPending
              ? "Reserving…"
              : isSeated
                ? "Reserve the same seats again"
                : "Reserve the same tickets again"}
          </Button>
          <ButtonLink href={routes.event(hold.eventSlug)}>Back to the event</ButtonLink>
        </div>
        <p className="text-sm text-ink-3">Anything you’d already filled in will be kept.</p>
      </div>
    </div>
  );
}
