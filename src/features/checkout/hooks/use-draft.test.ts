import { beforeEach, describe, expect, it } from "vitest";
import { testPeople } from "@/features/checkout/testing/fixtures";
import {
  copyDraft,
  createEmptyDraft,
  draftStorageKey,
  readDraft,
  resetDraftCacheForTests,
  writeDraft,
} from "./use-draft";

describe("draft", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDraftCacheForTests();
  });

  it("persists per hold and survives a cache reset (a reload)", () => {
    writeDraft("h1", { attendees: testPeople(1) });
    resetDraftCacheForTests();
    expect(readDraft("h1").attendees).toEqual(testPeople(1));
    expect(readDraft("h2")).toEqual(createEmptyDraft());
  });

  it("ignores corrupt storage", () => {
    sessionStorage.setItem(draftStorageKey("h1"), "{oops");
    expect(readDraft("h1")).toEqual(createEmptyDraft());
    sessionStorage.setItem(draftStorageKey("h2"), JSON.stringify({ attendees: "nope" }));
    expect(readDraft("h2")).toEqual(createEmptyDraft());
  });

  it("copies a draft to a new hold", () => {
    writeDraft("old", { attendees: testPeople(2), addOns: { x: 1 } });
    copyDraft("old", "new");
    expect(readDraft("new")).toMatchObject({ attendees: testPeople(2), addOns: { x: 1 } });
  });
});
