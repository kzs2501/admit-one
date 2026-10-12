"use client";

import { useEffect, useRef, useState } from "react";
import { announcedMs, crossedThreshold, formatRemaining, remainingMs, spokenRemaining, useNow } from "./countdown";

/**
 * "Tickets held for 4:32". The visible clock updates every second; screen readers
 * hear it only at 2 minutes, 1 minute and 30 seconds — not sixty times a minute.
 */
export function HoldTimer({ expiresAt, offset, onExpire }: { expiresAt: number; offset: number; onExpire: () => void }) {
  const now = useNow(true);
  const left = remainingMs(expiresAt, now, offset);
  const previous = useRef(left);
  const [announcement, setAnnouncement] = useState("");
  const expired = useRef(false);

  useEffect(() => {
    const crossed = crossedThreshold(previous.current, left);
    previous.current = left;
    if (crossed && left > 0) setAnnouncement(`${spokenRemaining(announcedMs(crossed, left))} left to complete your order.`);
    if (left === 0 && !expired.current) {
      expired.current = true;
      onExpire();
    }
  }, [left, onExpire]);

  const urgent = left <= 60_000;
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
        urgent ? "border-warn/40 bg-warn-soft" : "border-line bg-card"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 ${urgent ? "text-warn" : "text-ink-3"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5M9 2h6" />
      </svg>
      <span>
        Tickets held for{" "}
        <time className="tabular font-medium" aria-label={spokenRemaining(left)}>
          {formatRemaining(left)}
        </time>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
