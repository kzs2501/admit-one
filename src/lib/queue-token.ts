/**
 * Your place in each sale's waiting room, kept for this tab in sessionStorage (as the
 * sandbox itself is), so a refresh or a visit to another page keeps it. Components
 * read it with `useQueueToken`, which re-renders them when it changes, and reads
 * nothing on the server, so hydration can't disagree.
 */
import { useSyncExternalStore } from "react";
import { z } from "@/core/zod";
import { readSession, writeSession } from "./storage";

const keyFor = (eventSlug: string) => `admit-one:queue:${eventSlug}`;
const savedTokenSchema = z.object({ token: z.string().min(1) });

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const readQueueToken = (eventSlug: string): string | null =>
  readSession(keyFor(eventSlug), savedTokenSchema)?.token ?? null;

export function saveQueueToken(eventSlug: string, token: string | null) {
  if (token === null) {
    try {
      sessionStorage.removeItem(keyFor(eventSlug));
    } catch {
      // Storage blocked: there was nothing saved to forget.
    }
  } else {
    writeSession(keyFor(eventSlug), { token });
  }
  for (const listener of listeners) listener();
}

export function useQueueToken(eventSlug: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readQueueToken(eventSlug),
    () => null,
  );
}
