/**
 * The refunded tickets a door knows of, per event, in IndexedDB: downloaded while
 * online, and used offline, so a refunded ticket is refused even with no connection.
 * Its limit is when it was downloaded, which the scanner shows. Storage can be
 * refused, so both ways say whether it worked rather than throw.
 */
import { createStore, get, set, type UseStore } from "idb-keyval";

export interface DoorVoids {
  codes: readonly string[];
  /** When the list was the server's. */
  asOfMs: number;
}

// Opened on first use: there's no IndexedDB on the server.
let store: UseStore | null = null;
const voidStore = () => (store ??= createStore("admit-one-door-voids", "lists"));

export async function saveDoorVoids(eventSlug: string, voids: DoorVoids): Promise<boolean> {
  try {
    await set(eventSlug, voids, voidStore());
    return true;
  } catch {
    return false;
  }
}

/** The event's list as last downloaded here; null if there's none, or no storage. */
export async function loadDoorVoids(eventSlug: string): Promise<DoorVoids | null> {
  try {
    return (await get<DoorVoids>(eventSlug, voidStore())) ?? null;
  } catch {
    return null;
  }
}
