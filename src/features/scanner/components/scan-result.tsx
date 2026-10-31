import { formatEventTime } from "@/lib/format";
import type { Rejection } from "@/features/scanner/domain/check-ticket";
import type { DoorResult } from "@/features/scanner/hooks/use-door";

function rejectionText(rejection: Rejection): string {
  switch (rejection.reason) {
    case "not-a-ticket":
      return "This isn’t a Dress Circle ticket.";
    case "unknown-key":
      return "It’s signed with a key this scanner doesn’t trust.";
    case "forged":
      return "Its signature doesn’t match: the ticket has been changed.";
    case "other-event":
      return `This ticket is for ${rejection.eventName}.`;
    case "refunded":
      return "This ticket was refunded. It no longer gets anyone in.";
  }
}

const TONES = {
  idle: "border-line bg-sunk",
  admitted: "border-ok bg-ok-soft",
  "already-scanned": "border-warn bg-warn-soft",
  rejected: "border-bad bg-bad-soft",
  "no-code": "border-line bg-sunk",
} as const;

/**
 * The door's answer, big enough to read at arm's length, and in words as well as
 * colour (WCAG 1.4.1). A live region, so a screen reader announces each scan
 * (WCAG 4.1.3); each result is a new node, so the same answer twice is still heard.
 */
export function ScanResult({ result, timeZone }: { result: DoorResult | null; timeZone: string }) {
  return (
    <div
      role="status"
      aria-label="Last scan"
      aria-atomic="true"
      className={`rounded-xl border-2 px-5 py-6 transition-colors ${TONES[result?.kind ?? "idle"]}`}
    >
      {!result && (
        <>
          <p className="font-display text-2xl font-semibold">Ready</p>
          <p className="mt-1 text-ink-2">Point the camera at a ticket’s code, or scan a photo of one.</p>
        </>
      )}
      {result?.kind === "admitted" && (
        <div key={result.id}>
          <p className="font-display text-3xl font-semibold">
            <span aria-hidden="true">✓ </span>Admitted
          </p>
          <p className="mt-2 text-xl font-medium">{result.claims.attendeeName}</p>
          <p className="text-ink-2">
            {result.claims.tierName}
            {result.claims.seat && ` · ${result.claims.seat}`}
          </p>
          {!result.isRemembered && (
            <p className="mt-3 text-sm text-ink-2">
              This browser isn’t keeping a scan log, so it can’t tell if this ticket is shown again.
            </p>
          )}
        </div>
      )}
      {result?.kind === "already-scanned" && (
        <div key={result.id}>
          <p className="font-display text-3xl font-semibold">
            <span aria-hidden="true">! </span>Already scanned
          </p>
          <p className="mt-2 text-xl font-medium">{result.claims.attendeeName}</p>
          <p className="text-ink-2">
            First scanned at {formatEventTime(new Date(result.firstScannedAt).toISOString(), timeZone)} on this device.
          </p>
        </div>
      )}
      {result?.kind === "rejected" && (
        <div key={result.id}>
          <p className="font-display text-3xl font-semibold">
            <span aria-hidden="true">✕ </span>Not valid
          </p>
          <p className="mt-2 text-ink-2">{rejectionText(result.rejection)}</p>
        </div>
      )}
      {result?.kind === "no-code" && (
        <div key={result.id}>
          <p className="font-display text-2xl font-semibold">No code found</p>
          <p className="mt-1 text-ink-2">Try a sharper photo, with the whole code in it.</p>
        </div>
      )}
    </div>
  );
}
