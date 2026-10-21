import { useCallback, useEffect, useRef, useState } from "react";
import { countAdmitted, recordScan } from "@/lib/scan-log";
import type { TicketKeyring } from "@/core/ticket-token";
import { checkTicket, doorOutcome, type DoorOutcome } from "@/features/scanner/domain/check-ticket";

/** What the door shows: the last outcome, or that a photo had no code in it. */
export type DoorResult = (DoorOutcome | { kind: "no-code" }) & { id: number };

/** A short buzz to let someone in, a longer pattern to stop them, where the device has it. */
const VIBRATIONS: Record<DoorResult["kind"], number | number[]> = {
  admitted: 80,
  "already-scanned": [160, 80, 160],
  rejected: [160, 80, 160],
  "no-code": 0,
};

/**
 * The door for one event: checks each code it's given, remembers the tickets it lets
 * in, and keeps the last result to show. All on the device, so it works offline.
 */
export function useDoor(eventSlug: string, keyring: TicketKeyring) {
  const [result, setResult] = useState<DoorResult | null>(null);
  const [admitted, setAdmitted] = useState<number | null>(null);
  const nextId = useRef(0);
  const currentEvent = useRef(eventSlug);

  useEffect(() => {
    currentEvent.current = eventSlug;
    let isCurrent = true;
    void countAdmitted(eventSlug).then((count) => {
      if (isCurrent) setAdmitted(count);
    });
    return () => {
      isCurrent = false;
    };
  }, [eventSlug]);

  const show = useCallback((outcome: DoorOutcome | { kind: "no-code" }) => {
    nextId.current += 1;
    setResult({ ...outcome, id: nextId.current });
    const pattern = VIBRATIONS[outcome.kind];
    if (pattern && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  }, []);

  const scan = useCallback(
    async (code: string) => {
      const check = checkTicket(code, eventSlug, keyring);
      const memory = check.ok ? await recordScan(eventSlug, check.claims.code, Date.now()) : null;
      // The door may have switched events while the log answered.
      if (currentEvent.current !== eventSlug) return;
      const outcome = doorOutcome(check, memory);
      show(outcome);
      if (outcome.kind === "admitted") setAdmitted(await countAdmitted(eventSlug));
    },
    [eventSlug, keyring, show],
  );

  const noCode = useCallback(() => {
    show({ kind: "no-code" });
  }, [show]);

  const clear = useCallback(() => {
    setResult(null);
  }, []);

  return { result, admitted, scan, noCode, clear };
}
