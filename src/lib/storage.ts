/**
 * sessionStorage that can't throw and can't hand back garbage. Storage can be full,
 * blocked (privacy modes) or edited by hand, so every read is parsed against a schema
 * and every failure degrades to "nothing saved".
 */
import type { z } from "zod";

export function readSession<Schema extends z.ZodType>(key: string, schema: Schema): z.output<Schema> | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Returns whether the value was saved; an unsaved value simply lives for this page only. */
export function writeSession(key: string, value: unknown): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
