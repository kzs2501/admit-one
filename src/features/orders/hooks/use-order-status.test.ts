import { describe, expect, it } from "vitest";
import type { OrderDto, PaymentDto } from "@/contract/dto";
import type { OrderStatus } from "@/core/statuses";
import { ApiError, NetworkError } from "@/lib/api-client";
import { deriveOrderPageState, pollDelayMs, toOrderPageState } from "./use-order-status";

const payment = (status: PaymentDto["status"]): PaymentDto => ({
  id: "pay_1",
  status,
  last4: "4242",
  failureCode: null,
});

const order = (status: OrderStatus, paymentDto: PaymentDto | null = null): OrderDto => ({
  id: "ord_1",
  holdId: "hold_1",
  eventSlug: "open-studio-ceramics",
  items: [{ tierId: "osc-session", quantity: 1 }],
  attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
  addOns: {},
  amounts: { currency: "INR", ticketsMinor: 250000, addOnsMinor: 0, feesMinor: 7500, totalMinor: 257500 },
  status,
  statusReason: null,
  tickets: [],
  payment: paymentDto,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe("order page state", () => {
  it("polls while the provider has the charge", () => {
    expect(toOrderPageState(order("pending", payment("processing")), false)).toMatchObject({ kind: "confirming" });
    expect(toOrderPageState(order("paid", payment("succeeded")), true)).toMatchObject({
      kind: "confirming",
      isSlow: true,
    });
  });

  it("sends an unpaid order back to payment", () => {
    expect(toOrderPageState(order("pending"), false).kind).toBe("awaiting-payment");
    expect(toOrderPageState(order("pending", payment("requires_action")), false).kind).toBe("awaiting-payment");
  });

  it("shows each outcome as itself", () => {
    for (const status of ["fulfilled", "refunded", "expired", "failed"] as const) {
      expect(toOrderPageState(order(status), false).kind).toBe(status);
    }
  });

  it("backs off from half a second to every four", () => {
    expect([0, 1, 2, 3, 4, 10].map(pollDelayMs)).toEqual([500, 1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  it("keeps showing a known order when a status check fails", () => {
    const confirming = order("pending", payment("processing"));
    const lostConnection = new NetworkError("Couldn’t reach the server.");
    expect(deriveOrderPageState(confirming, lostConnection, false).kind).toBe("confirming");
    expect(deriveOrderPageState(undefined, lostConnection, false).kind).toBe("load-error");
  });

  it("believes the server when it says the order is gone", () => {
    const notFound = new ApiError({
      type: "/problems/not-found",
      title: "",
      status: 404,
      detail: "",
      code: "not_found",
    });
    expect(deriveOrderPageState(order("pending", payment("processing")), notFound, false).kind).toBe("not-found");
  });
});
