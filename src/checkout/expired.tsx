"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HoldView } from "@/shared/api-types";
import { describeItems } from "@/shared/money";
import { api, ApiError } from "@/lib/api";
import { Button, Notice } from "@/components/ui";
import { copyDraft } from "./draft";
import { stepHref, type StepId } from "./registry";

/**
 * The hold ran out. Offer to reserve the same tickets again — carrying over
 * everything the buyer already typed — rather than sending them back to the start.
 */
export function ExpiredPanel({ hold, step }: { hold: HoldView; step: StepId }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const again = useMutation({
    mutationFn: () => api.createHold(hold.eventSlug, hold.items),
    onSuccess: (res) => {
      copyDraft(hold.id, res.hold.id);
      queryClient.setQueryData(["hold", res.hold.id], res);
      router.replace(stepHref(res.hold.id, step));
    },
  });
  const goneAgain = again.error instanceof ApiError && again.error.code === "sold_out";

  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <h1 tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight">
        Your reservation expired
      </h1>
      <p className="mt-3 text-ink-2">
        We held {describeItems(hold.eventSlug, hold.items)} for you, but time ran out, so they’ve gone back on sale.
      </p>
      <div className="mt-6 space-y-4">
        {goneAgain ? (
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
          <Button onClick={() => again.mutate()} busy={again.isPending} disabled={goneAgain}>
            {again.isPending ? "Reserving…" : "Reserve the same tickets again"}
          </Button>
          <Link
            href={`/events/${hold.eventSlug}`}
            className="press inline-flex min-h-11 items-center rounded-lg border border-line bg-card px-5 text-sm font-medium hover:bg-sunk"
          >
            Back to the event
          </Link>
        </div>
        <p className="text-sm text-ink-3">Anything you’d already filled in will be kept.</p>
      </div>
    </div>
  );
}
