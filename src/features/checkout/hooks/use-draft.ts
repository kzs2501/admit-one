/**
 * What the buyer has typed but not yet submitted, kept per hold in sessionStorage so
 * a refresh — or a deep link back into the flow — loses nothing.
 */
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

export type Draft = {
  attendees: { name: string; email: string }[];
  addOns: Record<string, number>;
  addOnsConfirmed: boolean;
};

const draftSchema = z.object({
  attendees: z.array(z.object({ name: z.string(), email: z.string() })),
  addOns: z.record(z.string(), z.number().int().min(0)),
  addOnsConfirmed: z.boolean(),
});

export const emptyDraft = (): Draft => ({ attendees: [], addOns: {}, addOnsConfirmed: false });

const key = (holdId: string) => `admit-one:draft:${holdId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Draft>();

/** Read a draft. Corrupt or foreign data is treated as no draft at all. */
export function readDraft(holdId: string): Draft {
  const cached = cache.get(holdId);
  if (cached) return cached;
  let draft = emptyDraft();
  try {
    const parsed = draftSchema.safeParse(JSON.parse(sessionStorage.getItem(key(holdId)) ?? "null"));
    if (parsed.success) draft = parsed.data;
  } catch {
    // Unreadable storage: start empty.
  }
  cache.set(holdId, draft);
  return draft;
}

export function writeDraft(holdId: string, patch: Partial<Draft>) {
  const next = { ...readDraft(holdId), ...patch };
  cache.set(holdId, next);
  try {
    sessionStorage.setItem(key(holdId), JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the draft lives for this page only.
  }
  listeners.forEach((l) => l());
}

/** Carry a draft over to a new hold — used by "Reserve again" after expiry. */
export const copyDraft = (fromHoldId: string, toHoldId: string) => writeDraft(toHoldId, readDraft(fromHoldId));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const EMPTY = emptyDraft();

export function useDraft(holdId: string) {
  const draft = useSyncExternalStore(
    subscribe,
    () => readDraft(holdId),
    () => EMPTY,
  );
  const update = useCallback((patch: Partial<Draft>) => writeDraft(holdId, patch), [holdId]);
  return [draft, update] as const;
}

/** For tests. */
export const __resetDraftCache = () => cache.clear();
