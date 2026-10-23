import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attendeesFor, cardPayment, holdFor, orderFor, SUMMIT } from "@/contract/testing/dto-fixtures";
import { ApiError, apiClient, NetworkError } from "@/lib/api-client";
import { useCardPayment } from "./use-card-payment";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

const card = { number: "4242 4242 4242 4242", expiry: "12 / 30", cvc: "123", name: "Asha Rao" };

function renderPaying() {
  const order = orderFor(holdFor(SUMMIT), { attendees: attendeesFor(1), addOns: {} });
  const onRefused = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useCardPayment({ order, onExpired: vi.fn(), onDeclined: vi.fn(), onInvalidCard: vi.fn(), onRefused }),
    { wrapper },
  );
  return { ...hook, onRefused };
}

function render() {
  const challenged = cardPayment({ status: "requires_action", nextAction: { type: "card_challenge" } });
  const order = orderFor(holdFor(SUMMIT), { attendees: attendeesFor(1), addOns: {} }, { payment: challenged });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useCardPayment({ order, onExpired: vi.fn(), onDeclined: vi.fn(), onInvalidCard: vi.fn(), onRefused: vi.fn() }),
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

describe("paying by card, attempt by attempt", () => {
  it("after a lost answer, a corrected name is a new attempt; a corrected CVC isn't", async () => {
    const createPayment = vi.spyOn(apiClient, "createPayment").mockRejectedValue(new NetworkError("Lost."));
    const { result } = renderPaying();
    const pay = async (details: typeof card) => {
      act(() => {
        result.current.pay(details);
      });
      await waitFor(() => {
        expect(result.current.isPaying).toBe(false);
      });
    };
    await pay(card);
    await pay({ ...card, cvc: "321" });
    await pay({ ...card, name: "Asha R. Rao" });
    const keys = createPayment.mock.calls.map((call) => call[2]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("says why a payment didn't start, whatever the reason", async () => {
    vi.spyOn(apiClient, "createPayment").mockRejectedValue(
      new ApiError(
        {
          type: "https://admit-one.test/problems/rate-limited",
          title: "Too many attempts",
          status: 429,
          detail: "Try again in 10 seconds.",
          code: "rate_limited",
          retryAfterSeconds: 10,
        },
        10_000,
      ),
    );
    const { result, onRefused } = renderPaying();
    act(() => {
      result.current.pay(card);
    });
    await waitFor(() => {
      expect(onRefused).toHaveBeenCalledWith("Try again in 10 seconds.");
    });
  });
});
