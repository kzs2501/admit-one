import { beforeEach, describe, expect, it } from "vitest";
import { catalog } from "@/shared/catalog";
import type { EventView, HoldView, OrderView } from "@/shared/api-types";
import { applicableSteps, nextStep, orderMatchesDraft, previousStep, resolveStep, type StepContext } from "./registry";
import { __resetDraftCache, copyDraft, emptyDraft, readDraft, writeDraft, type Draft } from "./draft";
import { clockOffset, crossedThreshold, formatRemaining, remainingMs, spokenRemaining } from "./countdown";

const view = (slug: string): EventView => {
  const e = catalog.find((x) => x.slug === slug)!;
  return { ...e, tiers: e.tiers.map((t) => ({ ...t, available: 5 })) };
};
const hold = (slug: string, tierId: string, qty: number): HoldView => ({
  id: "hold_1",
  eventSlug: slug,
  items: [{ tierId, qty }],
  createdAt: 0,
  expiresAt: 1,
  status: "active",
  orderId: null,
});
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Guest ${i + 1}`, email: `g${i + 1}@example.com` }));
const order = (draft: Draft, status: OrderView["status"] = "pending"): OrderView => ({
  id: "ord_1",
  holdId: "hold_1",
  eventSlug: "frontend-systems-summit",
  items: [],
  attendees: draft.attendees,
  addOns: Object.fromEntries(Object.entries(draft.addOns).filter(([, q]) => q > 0)),
  amounts: { ticketsCents: 0, addOnsCents: 0, feesCents: 0, totalCents: 0 },
  status,
  statusReason: null,
  tickets: [],
  payment: null,
  createdAt: 0,
  updatedAt: 0,
});

const summit = (draft: Draft, o: OrderView | null = null): StepContext => ({
  event: view("frontend-systems-summit"),
  hold: hold("frontend-systems-summit", "fss-general", 2),
  draft,
  order: o,
});
const studio = (draft: Draft): StepContext => ({
  event: view("open-studio-ceramics"),
  hold: hold("open-studio-ceramics", "osc-session", 1),
  draft,
  order: null,
});

describe("step registry", () => {
  it("includes extras only for events that have them", () => {
    expect(applicableSteps(summit(emptyDraft())).map((s) => s.id)).toEqual(["attendees", "add-ons", "review", "payment"]);
    expect(applicableSteps(studio(emptyDraft())).map((s) => s.id)).toEqual(["attendees", "review", "payment"]);
  });

  it("won't let a buyer skip ahead", () => {
    const r = resolveStep("payment", summit(emptyDraft()));
    expect(r).toMatchObject({ redirect: true, step: { id: "attendees" } });
  });

  it("sends an inapplicable or unknown step to the first incomplete one", () => {
    expect(resolveStep("add-ons", studio({ ...emptyDraft(), attendees: people(1) }))).toMatchObject({ redirect: true, step: { id: "review" } });
    expect(resolveStep("nonsense", summit(emptyDraft()))).toMatchObject({ redirect: true, step: { id: "attendees" } });
  });

  it("allows any step whose earlier steps are complete, including going back", () => {
    const draft = { ...emptyDraft(), attendees: people(2), addOnsConfirmed: true };
    expect(resolveStep("review", summit(draft))).toMatchObject({ redirect: false, step: { id: "review" } });
    expect(resolveStep("attendees", summit(draft))).toMatchObject({ redirect: false });
  });

  it("requires a matching order before payment — editing attendees sends you back to review", () => {
    const draft = { ...emptyDraft(), attendees: people(2), addOnsConfirmed: true };
    expect(resolveStep("payment", summit(draft, order(draft)))).toMatchObject({ redirect: false, step: { id: "payment" } });
    const edited = { ...draft, attendees: [{ name: "Someone Else", email: "x@example.com" }, draft.attendees[1]] };
    expect(resolveStep("payment", summit(edited, order(draft)))).toMatchObject({ redirect: true, step: { id: "review" } });
  });

  it("treats a settled order as not resumable", () => {
    const draft = { ...emptyDraft(), attendees: people(2), addOnsConfirmed: true };
    expect(orderMatchesDraft(summit(draft, order(draft, "expired")))).toBe(false);
    expect(orderMatchesDraft(summit(draft, order(draft, "failed")))).toBe(true);
  });

  it("walks forward and back through applicable steps only", () => {
    const ctx = studio(emptyDraft());
    expect(nextStep("attendees", ctx)?.id).toBe("review");
    expect(previousStep("review", ctx)?.id).toBe("attendees");
    expect(previousStep("attendees", ctx)).toBeNull();
    expect(nextStep("payment", ctx)).toBeNull();
  });
});

describe("draft", () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDraftCache();
  });

  it("persists per hold and survives a cache reset (a reload)", () => {
    writeDraft("h1", { attendees: people(1) });
    __resetDraftCache();
    expect(readDraft("h1").attendees).toEqual(people(1));
    expect(readDraft("h2")).toEqual(emptyDraft());
  });

  it("ignores corrupt storage", () => {
    sessionStorage.setItem("admit-one:draft:h1", "{oops");
    expect(readDraft("h1")).toEqual(emptyDraft());
    sessionStorage.setItem("admit-one:draft:h2", JSON.stringify({ attendees: "nope" }));
    expect(readDraft("h2")).toEqual(emptyDraft());
  });

  it("copies a draft to a new hold", () => {
    writeDraft("old", { attendees: people(2), addOns: { x: 1 } });
    copyDraft("old", "new");
    expect(readDraft("new")).toMatchObject({ attendees: people(2), addOns: { x: 1 } });
  });
});

describe("countdown", () => {
  it("computes from expiresAt and corrects for clock skew", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    // The server is 2s ahead of us, so we have 2s less than our clock suggests.
    expect(remainingMs(10_000, 4_000, clockOffset(6_000, 4_000))).toBe(4_000);
    expect(remainingMs(10_000, 20_000)).toBe(0);
  });

  it("formats for eyes and for ears", () => {
    expect(formatRemaining(245_000)).toBe("4:05");
    expect(formatRemaining(8_200)).toBe("0:09");
    expect(spokenRemaining(245_000)).toBe("4 minutes 5 seconds");
    expect(spokenRemaining(60_000)).toBe("1 minute");
    expect(spokenRemaining(1_000)).toBe("1 second");
  });

  it("announces each threshold once, even if a second is skipped", () => {
    expect(crossedThreshold(121_000, 120_000)).toBe(120);
    expect(crossedThreshold(120_000, 119_000)).toBeNull();
    expect(crossedThreshold(64_000, 55_000)).toBe(60); // backgrounded tab jumped
    expect(crossedThreshold(90_000, 89_000)).toBeNull();
  });
});
