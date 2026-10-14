"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EventDto, HoldDto } from "@/contract/dto";
import { apiClient, problemOf } from "@/lib/api-client";
import { describeItems } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { copyDraft } from "@/features/checkout/hooks/use-draft";
import { stepHref, type StepId } from "@/features/checkout/domain/step-registry";

/**
 * The hold ran out. Offer to reserve the same tickets again — carrying over
 * everything the buyer already typed — rather than sending them back to the start.
 */
export function ExpiredPanel({ hold, event, step }: { hold: HoldDto; event: EventDto; step: StepId }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const again = useMutation({
    mutationFn: () => apiClient.createHold({ eventSlug: hold.eventSlug, items: hold.items }),
    onSuccess: (details) => {
      copyDraft(hold.id, details.hold.id);
      queryClient.setQueryData(["hold", details.hold.id], details);
      router.replace(stepHref(details.hold.id, step));
    },
  });
  const isGoneAgain = problemOf(again.error)?.code === "sold_out";

  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <h1 tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight">
        Your reservation expired
      </h1>
      <p className="mt-3 text-ink-2">
        We held {describeItems(event.tiers, hold.items)} for you, but time ran out, so they’ve gone back on sale.
      </p>
      <div className="mt-6 space-y-4">
        {isGoneAgain ? (
          <Notice tone="bad" title="Those tickets have gone" role="alert">
            Someone else reserved them after your hold expired.{" "}
            <Link href={`/events/${hold.eventSlug}`} className="underline underline-offset-4">
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
          <Button onClick={() => again.mutate()} busy={again.isPending} disabled={isGoneAgain}>
            {again.isPending ? "Reserving…" : "Reserve the same tickets again"}
          </Button>
          <Link
            href={`/events/${hold.eventSlug}`}
            className="inline-flex min-h-11 press items-center rounded-lg border border-line bg-card px-5 text-sm font-medium hover:bg-sunk"
          >
            Back to the event
          </Link>
        </div>
        <p className="text-sm text-ink-3">Anything you’d already filled in will be kept.</p>
      </div>
    </div>
  );
}
