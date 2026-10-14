import { describe, expect, it } from "vitest";
import { orderDtoFor, studioContext, summitContext, testPeople } from "@/features/checkout/testing/fixtures";
import { createEmptyDraft } from "@/features/checkout/hooks/use-draft";
import { applicableSteps, nextStep, orderMatchesDraft, previousStep, resolveStep } from "./step-registry";

describe("step registry", () => {
  it("includes extras only for events that have them", () => {
    expect(applicableSteps(summitContext(createEmptyDraft())).map((step) => step.id)).toEqual([
      "attendees",
      "add-ons",
      "review",
      "payment",
    ]);
    expect(applicableSteps(studioContext(createEmptyDraft())).map((step) => step.id)).toEqual([
      "attendees",
      "review",
      "payment",
    ]);
  });

  it("won't let a buyer skip ahead", () => {
    const resolution = resolveStep("payment", summitContext(createEmptyDraft()));
    expect(resolution).toMatchObject({ redirect: true, step: { id: "attendees" } });
  });

  it("sends an inapplicable or unknown step to the first incomplete one", () => {
    expect(resolveStep("add-ons", studioContext({ ...createEmptyDraft(), attendees: testPeople(1) }))).toMatchObject({
      redirect: true,
      step: { id: "review" },
    });
    expect(resolveStep("nonsense", summitContext(createEmptyDraft()))).toMatchObject({
      redirect: true,
      step: { id: "attendees" },
    });
  });

  it("allows any step whose earlier steps are complete, including going back", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2), hasConfirmedAddOns: true };
    expect(resolveStep("review", summitContext(draft))).toMatchObject({ redirect: false, step: { id: "review" } });
    expect(resolveStep("attendees", summitContext(draft))).toMatchObject({ redirect: false });
  });

  it("requires a matching order before payment — editing attendees sends you back to review", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2), hasConfirmedAddOns: true };
    expect(resolveStep("payment", summitContext(draft, orderDtoFor(draft)))).toMatchObject({
      redirect: false,
      step: { id: "payment" },
    });
    const edited = { ...draft, attendees: [{ name: "Someone Else", email: "x@example.com" }, draft.attendees[1]] };
    expect(resolveStep("payment", summitContext(edited, orderDtoFor(draft)))).toMatchObject({
      redirect: true,
      step: { id: "review" },
    });
  });

  it("treats a settled order as not resumable", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2), hasConfirmedAddOns: true };
    expect(orderMatchesDraft(summitContext(draft, orderDtoFor(draft, "expired")))).toBe(false);
    expect(orderMatchesDraft(summitContext(draft, orderDtoFor(draft, "failed")))).toBe(true);
  });

  it("walks forward and back through applicable steps only", () => {
    const context = studioContext(createEmptyDraft());
    expect(nextStep("attendees", context)?.id).toBe("review");
    expect(previousStep("review", context)?.id).toBe("attendees");
    expect(previousStep("attendees", context)).toBeNull();
    expect(nextStep("payment", context)).toBeNull();
  });
});
