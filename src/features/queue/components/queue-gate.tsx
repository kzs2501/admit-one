"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { formatRemaining, remainingMs, useNow } from "@/lib/clock";
import { formatCount } from "@/lib/format";
import { eventQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Notice } from "@/components/ui/notice";
import { useQueueEntry } from "@/features/queue/hooks/use-queue-entry";

/** Whether the sale has a queue can change while the page is open; check this often. */
const QUEUE_CHECK_MS = 5_000;

function TurnNotice({ admittedUntilMs }: { admittedUntilMs: number }) {
  const now = useNow(true);
  return (
    <Notice tone="ok" title="It’s your turn">
      Reserve within{" "}
      <span className="tabular font-medium text-ink">{formatRemaining(remainingMs(admittedUntilMs, now))}</span>, or
      your turn passes to the next person.
    </Notice>
  );
}

/**
 * The event page's door, in a sale with a waiting room. Without a turn, it offers the
 * queue — or says where you are in it — in place of the ticket choices; with one, it
 * shows the choices and how long the turn lasts. With no waiting room, it's invisible.
 * `isPrimary` marks the instance that speaks for the page; others just stay out of the way.
 */
export function QueueGate({
  slug,
  isPrimary = true,
  children,
}: {
  slug: string;
  isPrimary?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { data: event } = useQuery({ ...eventQueries.detail(slug), refetchInterval: QUEUE_CHECK_MS });
  const queue = useQueueEntry(slug);
  const { view } = queue;

  if (!event?.isQueueActive) return children;
  if (view?.kind === "admitted") {
    return (
      <div className="space-y-3">
        {isPrimary && <TurnNotice admittedUntilMs={view.admittedUntilMs} />}
        {children}
      </div>
    );
  }
  if (!isPrimary) return null;

  return (
    <section aria-labelledby="queue-gate-title" className="rounded-xl border border-line bg-card p-5">
      <h3 id="queue-gate-title" className="font-display text-lg font-semibold">
        {view?.kind === "waiting" ? "You’re in the queue" : "This sale has a queue"}
      </h3>
      {view?.kind === "waiting" ? (
        <>
          <p className="mt-1 text-sm text-ink-2">
            <span className="tabular font-medium text-ink">{formatCount(view.aheadCount)}</span> people ahead of you.
          </p>
          <div className="mt-4">
            <ButtonLink href={routes.queue(slug)}>See your place</ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            So many people (simulated) want tickets that they’re let in a few thousand at a time. Join the queue, and
            you can choose tickets when it’s your turn{view?.kind === "expired" ? " — your last turn has passed" : ""}.
          </p>
          {queue.joinError && (
            <div className="mt-3">
              <Notice tone="bad" title="Couldn’t join the queue" role="alert">
                {queue.joinError.message}
              </Notice>
            </div>
          )}
          <Button
            className="mt-4"
            isBusy={queue.isJoining}
            onClick={() => {
              queue.join({ onJoined: () => router.push(routes.queue(slug)) });
            }}
          >
            {queue.isJoining ? "Joining…" : "Join the queue"}
          </Button>
        </>
      )}
    </section>
  );
}
