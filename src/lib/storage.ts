/**
 * Web storage that can't throw and can't hand back garbage. Storage can be full,
 * blocked (privacy modes) or edited by hand, so every read is parsed against a schema
 * and every failure degrades to "nothing saved". Session storage is this tab's; local
 * storage is this device's, for what should outlast the tab (a door's chosen event).
 */
import type { z } from "@/core/zod";

type Area = "session" | "local";
const storageFor = (area: Area) => (area === "session" ? sessionStorage : localStorage);

function read<Schema extends z.ZodType>(area: Area, key: string, schema: Schema): z.output<Schema> | null {
  try {
    const raw = storageFor(area).getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(area: Area, key: string, value: unknown): boolean {
  try {
    storageFor(area).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const readSession = <Schema extends z.ZodType>(key: string, schema: Schema) => read("session", key, schema);

/** Returns whether the value was saved; an unsaved value simply lives for this page only. */
export const writeSession = (key: string, value: unknown): boolean => write("session", key, value);

export const readLocal = <Schema extends z.ZodType>(key: string, schema: Schema) => read("local", key, schema);

/** Returns whether the value was saved on this device. */
export const writeLocal = (key: string, value: unknown): boolean => write("local", key, value);
