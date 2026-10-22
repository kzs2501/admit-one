import { useEffect, useState } from "react";
import { problemOf } from "@/lib/api-client";
import { loadDoorVoids, saveDoorVoids } from "@/lib/door-voids";
import { organiserApi } from "@/lib/organiser-api";
import { readOrganiserToken } from "@/lib/organiser-session";

/** How often a door asks again while it's online. */
const REFRESH_MS = 60_000;

/** How current the door's list of refunded tickets is. */
export type RefundCheck =
  | { kind: "loading" }
  /** The list as the server had it at `asOfMs`: just now, or before going offline. */
  | { kind: "checked"; asOfMs: number }
  /** No organiser signed in here to fetch it; `asOfMs` is the list this device has, if any. */
  | { kind: "signed-out"; asOfMs: number | null }
  /** This build has no organisers' API (server mode), and so no refunds to know of. */
  | { kind: "unavailable" };

/**
 * The refunded tickets of the door's event: the copy on this device at once, then, while
 * online with an organiser signed in, the server's, every minute and whenever the
 * connection comes back. A signature alone can't say a ticket was refunded.
 */
export function useDoorVoids(eventSlug: string) {
  const [codes, setCodes] = useState<ReadonlySet<string>>(new Set());
  const [check, setCheck] = useState<RefundCheck>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    let saved: number | null = null;
    const apply = (list: { codes: readonly string[]; asOfMs: number }) => {
      if (!isCurrent) return;
      saved = list.asOfMs;
      setCodes(new Set(list.codes));
    };

    const sync = async () => {
      if (!readOrganiserToken()) {
        if (isCurrent) setCheck({ kind: "signed-out", asOfMs: saved });
        return;
      }
      try {
        const list = await organiserApi.getDoorList(eventSlug);
        const voids = { codes: list.voidedCodes, asOfMs: Date.parse(list.asOf) };
        await saveDoorVoids(eventSlug, voids);
        apply(voids);
        if (isCurrent) setCheck({ kind: "checked", asOfMs: voids.asOfMs });
      } catch (error) {
        if (!isCurrent) return;
        const code = problemOf(error)?.code;
        if (code === "not_in_server_mode") setCheck({ kind: "unavailable" });
        else if (code === "unauthenticated") setCheck({ kind: "signed-out", asOfMs: saved });
        // Offline, or the server didn't answer: the list this device has stands.
        else setCheck(saved === null ? { kind: "signed-out", asOfMs: null } : { kind: "checked", asOfMs: saved });
      }
    };

    void (async () => {
      const stored = await loadDoorVoids(eventSlug);
      if (stored) apply(stored);
      await sync();
    })();
    const timer = setInterval(() => void sync(), REFRESH_MS);
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      isCurrent = false;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [eventSlug]);

  return { codes, check };
}
