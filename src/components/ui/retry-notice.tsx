"use client";

import { useEffect, useState } from "react";
import { formatRemaining, remainingMs, spokenRemaining, useNow } from "@/lib/clock";
import { Notice } from "./notice";

/**
 * "Too many attempts — you can try again in 0:12." Counts down to the moment the server
 * named in `Retry-After`, then calls `onReady` so the action can be offered again.
 * Screen readers hear the wait once, in words, when the notice appears; the ticking
 * clock is for eyes only, or it would be announced every second.
 */
export function RetryNotice({ retryAtMs, onReady }: { retryAtMs: number; onReady: () => void }) {
  const now = useNow(true);
  const leftMs = remainingMs(retryAtMs, now);
  const [spokenWait] = useState(() => spokenRemaining(remainingMs(retryAtMs, Date.now())));

  useEffect(() => {
    if (leftMs === 0) onReady();
  }, [leftMs, onReady]);

  return (
    <Notice tone="warn" title="Too many attempts" role="status">
      <span className="sr-only">To keep the sale fair, reserving is limited. You can try again in {spokenWait}.</span>
      <span aria-hidden="true">
        To keep the sale fair, reserving is limited. You can try again in{" "}
        <span className="tabular font-medium text-ink">{formatRemaining(leftMs)}</span>.
      </span>
    </Notice>
  );
}
