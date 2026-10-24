/**
 * The organiser's signed-in session for this tab: a bearer token, kept in
 * sessionStorage like the sandbox it belongs to. Components read it with
 * `useOrganiserToken`, which re-renders them when it changes (signing in, signing out,
 * or a 401 that ends it), and reads nothing on the server, so hydration can't disagree.
 *
 * In production a first-party dashboard would keep its session in an HttpOnly cookie,
 * out of reach of any script; this sandbox has no server to set one (ADR 014).
 */
import { useSyncExternalStore } from "react";
import * as z from "@/core/zod";
import { readSession, writeSession } from "./storage";

const KEY = "admit-one:organiser-session";
const savedSessionSchema = z.object({ token: z.string().min(1) });

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const readOrganiserToken = (): string | null => readSession(KEY, savedSessionSchema)?.token ?? null;

export function saveOrganiserToken(token: string | null) {
  if (token === null) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Storage blocked: there was nothing saved to forget.
    }
  } else {
    writeSession(KEY, { token });
  }
  for (const listener of listeners) listener();
}

/** The token, or null — and `undefined` on the server, where there's no session to read yet. */
export function useOrganiserToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, readOrganiserToken, () => undefined);
}
