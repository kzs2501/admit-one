"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getEvent } from "@/core/catalog";
import { formatRemaining, remainingMs, useNow } from "@/lib/clock";
import { formatCount, formatWait } from "@/lib/format";
import { eventQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { passedMilestone } from "@/features/queue/domain/queue-view";
import { useQueueEntry } from "@/features/queue/hooks/use-queue-entry";

const QUEUE_CHECK_MS = 5_000;

/**
 * The waiting room. Honest about where you are — how many are ahead, a bar that only
 * moves forward, a wait said coarsely — and calm about it: it speaks at milestones, not
 * on every update, and when your turn comes it says so, moves focus to it and changes
 * the tab's title, but doesn't whisk you away (WCAG 3.2.5): you might be in another tab.
 */
export function WaitingRoom({ slug }: { slug: string }) {
  const event = getEvent(slug);
  const { data: live } = useQuery({ ...eventQueries.detail(slug), refetchInterval: QUEUE_CHECK_MS });
  const queue = useQueueEntry(slug);
  const { view, entry } = queue;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousAhead = useRef<number | null>(null);
  const [milestoneAnnouncement, setMilestoneAnnouncement] = useState("");
  const now = useNow(view?.kind === "admitted");

  // Milestones, once each.
  const aheadCount = view?.kind === "waiting" ? view.aheadCount : null;
  useEffect(() => {
    if (aheadCount === null || !entry) return;
    const previous = previousAhead.current;
    previousAhead.current = aheadCount;
    const words = previous === null ? null : passedMilestone(previous, aheadCount, entry.aheadAtJoin);
    if (words) setMilestoneAnnouncement(`${words} ${formatCount(aheadCount)} people ahead of you.`);
  }, [aheadCount, entry]);

  // Your turn: say it, move focus to it, and let a tab in the background know too.
  const isAdmitted = view?.kind === "admitted";
  const announcement = isAdmitted
    ? "It’s your turn. Choose your tickets before your turn runs out."
    : milestoneAnnouncement;
  useEffect(() => {
    if (isAdmitted) heading.current?.focus();
  }, [isAdmitted]);

  useEffect(() => {
    const title =
      view?.kind === "waiting"
        ? `(${formatCount(view.aheadCount)} ahead) Queue`
        : view?.kind === "admitted"
          ? "It’s your turn"
          : "Queue";
    document.title = `${title} · admit-one`;
  }, [view]);

  const body = (() => {
    if (live?.isQueueActive === false) {
      return (
        <>
          <h1 className="font-display text-3xl font-semibold tracking-tight">There’s no queue right now</h1>
          <p className="mt-3 text-ink-2">You can choose tickets straight away.</p>
          <div className="mt-6">
            <ButtonLink href={routes.event(slug)}>Choose tickets</ButtonLink>
          </div>
        </>
      );
    }
    if (queue.isChecking) {
      return (
        <div className="grid min-h-[30vh] place-items-center">
          <Spinner label="Finding your place in the queue" className="size-6 text-ink-3" />
        </div>
      );
    }
    switch (view?.kind) {
      case "waiting":
        return (
          <>
            <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">
              You’re in the queue
            </h1>
            <p className="mt-6 font-display text-5xl font-semibold tracking-tight">
              <span className="tabular">{formatCount(view.aheadCount)}</span>
            </p>
            <p className="mt-1 text-ink-2">people ahead of you</p>
            <progress
              value={view.progress}
              max={1}
              aria-label="Your place in the queue"
              className="mt-6 h-2 w-full appearance-none overflow-hidden rounded-full bg-sunk [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-sunk [&::-webkit-progress-value]:bg-accent"
            />
            <p className="mt-3 text-sm text-ink-2">
              Estimated wait: <span className="font-medium text-ink">{formatWait(view.estimatedWaitMs)}</span>
            </p>
            <p className="mt-6 max-w-prose text-sm text-ink-3">
              Keep this tab open. You’ll keep your place if you refresh, and we’ll tell you when it’s your turn. The
              people ahead of you are simulated: in this demo, you’re the only real buyer.
            </p>
          </>
        );
      case "admitted":
        return (
          <>
            <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">
              It’s your turn
            </h1>
            <p className="mt-3 text-ink-2">
              You have{" "}
              <span className="tabular font-medium text-ink">
                {formatRemaining(remainingMs(view.admittedUntilMs, now))}
              </span>{" "}
              to choose tickets; then your turn passes to the next person.
            </p>
            <div className="mt-6">
              <ButtonLink href={routes.event(slug)}>Choose tickets</ButtonLink>
            </div>
          </>
        );
      case "expired":
      case undefined:
        return (
          <>
            <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">
              {view?.kind === "expired" ? "Your turn has passed" : "Join the queue"}
            </h1>
            <p className="mt-3 text-ink-2">
              {view?.kind === "expired"
                ? "You didn’t reserve in time, so the next person got their turn. Join again for another."
                : "This sale has a queue. Join it, and you can choose tickets when it’s your turn."}
            </p>
            {queue.joinError && (
              <div className="mt-4">
                <Notice tone="bad" title="Couldn’t join the queue" role="alert">
                  {queue.joinError.message}
                </Notice>
              </div>
            )}
            <Button className="mt-6" isBusy={queue.isJoining} onClick={() => queue.join()}>
              {queue.isJoining ? "Joining…" : view?.kind === "expired" ? "Join again" : "Join the queue"}
            </Button>
          </>
        );
    }
  })();

  return (
    <div className="mx-auto max-w-lg px-5 py-16 sm:px-8">
      <p className="tabular text-xs tracking-[0.12em] text-ink-3 uppercase">{event.name}</p>
      <div className="mt-3">{body}</div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
