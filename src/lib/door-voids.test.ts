import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadDoorVoids, saveDoorVoids } from "./door-voids";

describe("a door's list of refunded tickets", () => {
  it("keeps each event's list on the device, as of when it was downloaded", async () => {
    expect(await loadDoorVoids("open-studio-ceramics")).toBeNull();
    expect(await saveDoorVoids("open-studio-ceramics", { codes: ["AO-1", "AO-2"], asOfMs: 1_000 })).toBe(true);
    expect(await saveDoorVoids("monsoon-strings", { codes: [], asOfMs: 2_000 })).toBe(true);
    expect(await loadDoorVoids("open-studio-ceramics")).toEqual({ codes: ["AO-1", "AO-2"], asOfMs: 1_000 });
    expect(await loadDoorVoids("monsoon-strings")).toEqual({ codes: [], asOfMs: 2_000 });
  });
});
