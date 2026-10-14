/**
 * What the buyer has typed but not yet submitted, kept per hold in sessionStorage so
 * a refresh — or a deep link back into the flow — loses nothing.
 */
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import { readSession, writeSession } from "@/lib/storage";

/** Unvalidated: the draft holds whatever was typed, including half-finished input. */
const draftSchema = z.object({
  attendees: z.array(z.object({ name: z.string(), email: z.string() })),
  addOns: z.record(z.string(), z.number().int().min(0)),
  hasConfirmedAddOns: z.boolean(),
});

export type Draft = z.infer<typeof draftSchema>;

export const createEmptyDraft = (): Draft => ({ attendees: [], addOns: {}, hasConfirmedAddOns: false });

/** One sessionStorage entry per hold. */
export const draftStorageKey = (holdId: string) => `admit-one:draft:${holdId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Draft>();

/** Read a draft. Corrupt or foreign data is treated as no draft at all. */
export function readDraft(holdId: string): Draft {
  const cached = cache.get(holdId);
  if (cached) return cached;
  const draft = readSession(draftStorageKey(holdId), draftSchema) ?? createEmptyDraft();
  cache.set(holdId, draft);
  return draft;
}

export function writeDraft(holdId: string, patch: Partial<Draft>) {
  const next = { ...readDraft(holdId), ...patch };
  cache.set(holdId, next);
  writeSession(draftStorageKey(holdId), next); // if storage refuses, the draft lives for this page only
  listeners.forEach((listener) => {
    listener();
  });
}

/** Carry a draft over to a new hold — used by "Reserve again" after expiry. */
export const copyDraft = (fromHoldId: string, toHoldId: string) => writeDraft(toHoldId, readDraft(fromHoldId));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const EMPTY_DRAFT = createEmptyDraft();

export function useDraft(holdId: string) {
  const draft = useSyncExternalStore(
    subscribe,
    () => readDraft(holdId),
    () => EMPTY_DRAFT,
  );
  const update = useCallback((patch: Partial<Draft>) => writeDraft(holdId, patch), [holdId]);
  return [draft, update] as const;
}

/** Forget cached drafts, as a reload would. For tests. */
export const resetDraftCacheForTests = () => {
  cache.clear();
};
