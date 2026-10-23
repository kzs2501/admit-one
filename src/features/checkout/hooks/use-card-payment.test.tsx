import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attendeesFor, cardPayment, holdFor, orderFor, SUMMIT } from "@/contract/testing/dto-fixtures";
import { apiClient, NetworkError } from "@/lib/api-client";
import { useCardPayment } from "./use-card-payment";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

function render() {
  const challenged = cardPayment({ status: "requires_action", nextAction: { type: "card_challenge" } });
  const order = orderFor(holdFor(SUMMIT), { attendees: attendeesFor(1), addOns: {} }, { payment: challenged });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useCardPayment({ order, onExpired: vi.fn(), onDeclined: vi.fn(), onInvalidCard: vi.fn() }),
    { wrapper },
  );
  return { ...hook, paymentId: challenged.id };
}

describe("answering the bank's 3-D Secure check", () => {
  it("keeps the check open, and says so, when the answer doesn't reach the bank", async () => {
    vi.spyOn(apiClient, "confirmChallenge").mockRejectedValue(new NetworkError("Couldn’t reach the server."));
    const { result, paymentId } = render();
    expect(result.current.challengePaymentId).toBe(paymentId);
    act(() => {
      result.current.authenticate("approve");
    });
    await waitFor(() => {
      expect(result.current.hasChallengeConnectionProblem).toBe(true);
    });
    expect(result.current.challengePaymentId).toBe(paymentId);
  });

  it("closes the check when it's dismissed, so paying again opens it anew", () => {
    const { result } = render();
    act(() => {
      result.current.dismissChallenge();
    });
    expect(result.current.challengePaymentId).toBeNull();
  });
});
