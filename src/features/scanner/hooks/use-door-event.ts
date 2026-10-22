import { useSyncExternalStore } from "react";
import { CATALOG, findEvent } from "@/core/catalog";
import { z } from "@/core/zod";
import { readLocal, writeLocal } from "@/lib/storage";

/**
 * The event this door is checking, kept on the device, so a reload (or opening the
 * scanner offline tomorrow) doesn't quietly switch the door back to the first event
 * and turn every valid ticket away as "for another event".
 */
const KEY = "admit-one:door-event";
const FIRST_EVENT = CATALOG[0]?.slug ?? "";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

const readDoorEvent = () => {
  const saved = readLocal(KEY, z.string());
  return saved !== null && findEvent(saved) ? saved : FIRST_EVENT;
};

/** The chosen event, and a way to choose another. On the server, before storage can be read, the first event. */
export function useDoorEvent(): [string, (eventSlug: string) => void] {
  const eventSlug = useSyncExternalStore(subscribe, readDoorEvent, () => FIRST_EVENT);
  const choose = (next: string) => {
    writeLocal(KEY, next);
    for (const listener of listeners) listener();
  };
  return [eventSlug, choose];
}
