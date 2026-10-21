import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { countAdmitted, recordScan } from "./scan-log";

describe("the door's scan log", () => {
  it("remembers a ticket's first scan, and answers it to every scan after", async () => {
    expect(await recordScan("open-studio-ceramics", "AO-1", 1_000)).toEqual({ isFirst: true, firstScannedAt: 1_000 });
    expect(await recordScan("open-studio-ceramics", "AO-1", 5_000)).toEqual({ isFirst: false, firstScannedAt: 1_000 });
    expect(await recordScan("open-studio-ceramics", "AO-2", 6_000)).toEqual({ isFirst: true, firstScannedAt: 6_000 });
  });

  it("keeps each event's scans apart", async () => {
    expect((await recordScan("monsoon-strings", "AO-1", 7_000))?.isFirst).toBe(true);
    expect(await countAdmitted("open-studio-ceramics")).toBe(2);
    expect(await countAdmitted("monsoon-strings")).toBe(1);
    expect(await countAdmitted("night-market-jazz")).toBe(0);
  });

  it("takes a ticket for new once, even when two scans of it land in the same moment", async () => {
    const scans = await Promise.all([
      recordScan("night-market-jazz", "AO-9", 8_000),
      recordScan("night-market-jazz", "AO-9", 8_000),
    ]);
    expect(scans.filter((scan) => scan?.isFirst)).toHaveLength(1);
  });
});
