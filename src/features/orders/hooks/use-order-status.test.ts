import { describe, expect, it } from "vitest";
import type { OrderDto, PaymentDto } from "@/contract/dto";
import type { OrderStatus } from "@/core/statuses";
import { ApiError, NetworkError } from "@/lib/api-client";
import { deriveOrderPageState, orderPollDelayMs, pollDelayMs, toOrderPageState } from "./use-order-status";

const payment = (status: PaymentDto["status"]): PaymentDto => ({
  id: "pay_1",
  method: "card",
  status,
  last4: "4242",
  failureCode: null,
  nextAction: null,
});

const order = (status: OrderStatus, paymentDto: PaymentDto | null = null): OrderDto => ({
  id: "ord_1",
  holdId: "hold_1",
  eventSlug: "open-studio-ceramics",
  items: [{ tierId: "osc-session", quantity: 1 }],
  seats: [],
  attendees: [{ name: "Asha Rao", email: "asha@example.com" }],
  addOns: {},
  amounts: {
    currency: "INR",
    ticketsMinor: 250000,
    addOnsMinor: 0,
    feesMinor: 7500,
    taxMinor: 0,
    totalMinor: 257500,
    taxLines: [],
  },
  status,
  statusReason: null,
  tickets: [],
  payment: paymentDto,
  paymentMethods: ["card"],
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
      type: "https://dresscircle.test/problems/not-found",
      title: "",
      status: 404,
      detail: "",
      code: "not_found",
    });
    expect(deriveOrderPageState(order("pending", payment("processing")), notFound, false).kind).toBe("not-found");
  });
});

describe("when the order page looks again", () => {
  const counts = { dataUpdateCount: 2, errorUpdateCount: 3 };
  const notFound = new ApiError(
    {
      type: "https://dresscircle.test/problems/not-found",
      title: "Not found",
      status: 404,
      detail: "No such order.",
      code: "not_found",
    },
    null,
  );

  it("keeps looking while the payment waits to be confirmed, sooner first", () => {
    expect(orderPollDelayMs(order("pending", payment("processing")), null, counts)).toBe(pollDelayMs(2));
  });

  it("stops once the order is settled", () => {
    expect(orderPollDelayMs(order("fulfilled", payment("succeeded")), null, counts)).toBe(false);
  });

  it("stops when there's no such order: nothing will change", () => {
    expect(orderPollDelayMs(undefined, notFound, counts)).toBe(false);
  });

  it("backs off while the server can't be read", () => {
    expect(orderPollDelayMs(undefined, new NetworkError("Lost."), counts)).toBe(pollDelayMs(3));
  });
});
