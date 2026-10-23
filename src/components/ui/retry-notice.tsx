"use client";

import { useEffect, useState } from "react";
import { formatRemaining, remainingMs, spokenRemaining, useNow } from "@/lib/clock";
import { Notice } from "./notice";

/**
 * "Too many attempts — you can try again in 0:12." Counts down to the moment the server
 * named in `Retry-After`, then calls `onReady` so the action can be offered again; with
 * no wait (`retryAtMs` null) it shows nothing.
 *
 * Screen readers hear the wait once, in words, from a status region that's mounted
 * before it has anything to say: one that arrives with its words already in it isn't
 * reliably read out. The ticking clock is for eyes only, or it would be announced
 * every second.
 */
export function RetryNotice({ retryAtMs, onReady }: { retryAtMs: number | null; onReady: () => void }) {
  return (
    <>
      <p role="status" className="sr-only">
        {retryAtMs !== null && <SpokenWait key={retryAtMs} retryAtMs={retryAtMs} />}
      </p>
      {retryAtMs !== null && <Countdown retryAtMs={retryAtMs} onReady={onReady} />}
    </>
  );
}

function SpokenWait({ retryAtMs }: { retryAtMs: number }) {
  const [spokenWait] = useState(() => spokenRemaining(remainingMs(retryAtMs, Date.now())));
  return <>Too many attempts. To keep the sale fair, reserving is limited. You can try again in {spokenWait}.</>;
}

function Countdown({ retryAtMs, onReady }: { retryAtMs: number; onReady: () => void }) {
  const now = useNow(true);
  const leftMs = remainingMs(retryAtMs, now);

  useEffect(() => {
    if (leftMs === 0) onReady();
  }, [leftMs, onReady]);

  return (
    <div aria-hidden="true">
      <Notice tone="warn" title="Too many attempts">
        To keep the sale fair, reserving is limited. You can try again in{" "}
        <span className="tabular font-medium text-ink">{formatRemaining(leftMs)}</span>.
      </Notice>
    </div>
  );
}
