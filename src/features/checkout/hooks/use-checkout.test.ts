import { describe, expect, it } from "vitest";
import type { HoldDetailsDto } from "@/contract/dto";
import { ApiError, NetworkError } from "@/lib/api-client";
import { eventDtoFor, holdDtoFor, orderDtoFor, testPeople } from "@/features/checkout/testing/fixtures";
import { createEmptyDraft } from "./use-draft";
import { deriveCheckout, type CheckoutInputs } from "./use-checkout";

const details = (overrides: Partial<HoldDetailsDto> = {}): HoldDetailsDto => ({
  hold: holdDtoFor("frontend-systems-summit", "fss-general", 2),
  event: eventDtoFor("frontend-systems-summit"),
  order: null,
  serverTime: new Date(0).toISOString(),
  ...overrides,
});

const inputs = (overrides: Partial<CheckoutInputs> = {}): CheckoutInputs => ({
  requestedStep: "attendees",
  details: details(),
  error: null,
  fetchedAtMs: 0,
  draft: createEmptyDraft(),
  isMounted: true,
  hasExpiredLocally: false,
  ...overrides,
});

const notFound = new ApiError({
  type: "https://admit-one.test/problems/not-found",
  title: "",
  status: 404,
  detail: "",
  code: "not_found",
});

describe("deriveCheckout", () => {
  it("shows the requested step when it's allowed", () => {
    const { state, redirectStepId } = deriveCheckout(inputs());
    expect(state).toMatchObject({ kind: "ready", step: { id: "attendees" }, stepIndex: 0 });
    expect(redirectStepId).toBeNull();
  });

  it("waits for the browser before resolving the step (drafts live in sessionStorage)", () => {
    expect(deriveCheckout(inputs({ isMounted: false })).state.kind).toBe("loading");
  });

  it("redirects a skipped-ahead URL to the first incomplete step", () => {
    const { state, redirectStepId } = deriveCheckout(inputs({ requestedStep: "payment" }));
    expect(state.kind).toBe("loading");
    expect(redirectStepId).toBe("attendees");
  });

  it("tells a missing reservation apart from any other failure", () => {
    expect(deriveCheckout(inputs({ details: undefined, error: notFound })).state.kind).toBe("not-found");
    expect(deriveCheckout(inputs({ details: undefined, error: new Error("boom") })).state.kind).toBe("load-error");
  });

  it("keeps the checkout on screen when a refresh fails, but not when the reservation is gone", () => {
    const lostConnection = new NetworkError("Couldn’t reach the server.");
    expect(deriveCheckout(inputs({ error: lostConnection })).state.kind).toBe("ready");
    expect(deriveCheckout(inputs({ error: notFound })).state.kind).toBe("not-found");
  });

  it("shows the expired state, remembering the step the buyer was on", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2) };
    const { state, redirectStepId } = deriveCheckout(
      inputs({ requestedStep: "add-ons", draft, hasExpiredLocally: true }),
    );
    expect(state).toMatchObject({ kind: "expired", stepId: "add-ons" });
    expect(redirectStepId).toBeNull();
  });

  it("hands over to the order page once the payment is with the provider", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2), hasConfirmedAddOns: true };
    const order = {
      ...orderDtoFor(draft),
      payment: {
        id: "pay_1",
        method: "card" as const,
        status: "processing" as const,
        last4: "4242",
        failureCode: null,
        nextAction: null,
      },
    };
    const { state, orderPageId } = deriveCheckout(
      inputs({ requestedStep: "payment", draft, details: details({ order }) }),
    );
    expect(state.kind).toBe("loading");
    expect(orderPageId).toBe("ord_1");
  });

  it("keeps a 3-D Secure challenge in the checkout, where the dialog lives", () => {
    const draft = { ...createEmptyDraft(), attendees: testPeople(2), hasConfirmedAddOns: true };
    const order = {
      ...orderDtoFor(draft),
      payment: {
        id: "pay_1",
        method: "card" as const,
        status: "requires_action" as const,
        last4: "3155",
        failureCode: null,
        nextAction: { type: "card_challenge" as const },
      },
    };
    const { state, orderPageId } = deriveCheckout(
      inputs({ requestedStep: "payment", draft, details: details({ order }) }),
    );
    expect(state).toMatchObject({ kind: "ready", step: { id: "payment" } });
    expect(orderPageId).toBeNull();
  });
});
