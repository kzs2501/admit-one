// @vitest-environment node
/**
 * Every name already stored on someone's device, spelled out. A rename that reached
 * one of these would lose saved tickets, the door's memory or the offline pages, so
 * changing one has to be a decision made here, not a side effect of find-and-replace.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATABASES, PREPARE_OFFLINE_MESSAGE, STORAGE_KEYS } from "./persisted-names";
import { TICKET_TOKEN_VERSION } from "./ticket-token";

describe("persisted names", () => {
  it("keep the storage keys devices already hold", () => {
    expect(STORAGE_KEYS.sandbox(15)).toBe("admit-one:sandbox:v15");
    expect(STORAGE_KEYS.draft("hold_1")).toBe("admit-one:draft:hold_1");
    expect(STORAGE_KEYS.queue("monsoon-strings")).toBe("admit-one:queue:monsoon-strings");
    expect(STORAGE_KEYS.organiserSession).toBe("admit-one:organiser-session");
    expect(STORAGE_KEYS.doorEvent).toBe("admit-one:door-event");
  });

  it("keep the IndexedDB databases devices already hold", () => {
    expect(DATABASES).toEqual({
      wallet: "admit-one-wallet",
      door: "admit-one-door",
      doorVoids: "admit-one-door-voids",
    });
  });

  it("keep the ticket format that tickets already issued carry", () => {
    expect(TICKET_TOKEN_VERSION).toBe("ao1");
  });

  it("agree with the service worker, which can't import them", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(PREPARE_OFFLINE_MESSAGE).toBe("admit-one:prepare-offline");
    expect(worker).toContain(`const PREPARE_OFFLINE = "${PREPARE_OFFLINE_MESSAGE}";`);
    // Its caches: the current ones, and the prefix it clears old versions by.
    expect(worker).toContain("const PAGES = `admit-one-pages-${VERSION}`;");
    expect(worker).toContain("const ASSETS = `admit-one-assets-${VERSION}`;");
    expect(worker).toContain('name.startsWith("admit-one-")');
  });
});
