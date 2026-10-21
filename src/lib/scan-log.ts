/**
 * The door's memory on this device, in IndexedDB: which tickets it has let in, and
 * when. It works offline, and it's how the scanner catches a ticket shown twice. Its
 * limit is the device: two doors, each offline, would each let a copied ticket in once.
 */
import { createStore, keys, update, type UseStore } from "idb-keyval";

// Opened on first use: there's no IndexedDB on the server.
let store: UseStore | null = null;
const scanStore = () => (store ??= createStore("admit-one-door", "scans"));

const keyOf = (eventSlug: string, code: string) => `${eventSlug}/${code}`;

/** What the device remembers of a ticket when it's scanned. */
export interface ScanMemory {
  /** True for the first scan of this ticket here. */
  isFirst: boolean;
  firstScannedAt: number;
}

/**
 * Record a scan of a ticket that checked out, and answer whether it's the first scan
 * of it here, and when that was. One transaction reads and writes, so two tabs can't
 * both take a ticket for new. Null if this browser won't keep anything.
 */
export async function recordScan(eventSlug: string, code: string, at: number): Promise<ScanMemory | null> {
  try {
    let memory: ScanMemory = { isFirst: true, firstScannedAt: at };
    await update<number>(
      keyOf(eventSlug, code),
      (previous) => {
        memory =
          previous === undefined ? { isFirst: true, firstScannedAt: at } : { isFirst: false, firstScannedAt: previous };
        return memory.firstScannedAt;
      },
      scanStore(),
    );
    return memory;
  } catch {
    return null;
  }
}

/** How many tickets this device has let in for an event; null if it can't tell. */
export async function countAdmitted(eventSlug: string): Promise<number | null> {
  try {
    const prefix = keyOf(eventSlug, "");
    return (await keys(scanStore())).filter((key) => typeof key === "string" && key.startsWith(prefix)).length;
  } catch {
    return null;
  }
}
