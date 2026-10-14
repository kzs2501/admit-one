// @vitest-environment node
/**
 * The client is the boundary between the network and the UI: these tests check that
 * whatever comes back — a valid answer, a problem, garbage or nothing — becomes a
 * typed value or one of exactly two typed errors.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import { apiClient, ApiError, NetworkError, problemOf } from "./api-client";

const network = setupServer();

// Node's fetch needs absolute URLs; the client builds relative ones, as a browser would.
// Wrap fetch *after* MSW has patched it, so requests still reach the mock network.
let unwrappedFetch: typeof fetch;
beforeAll(() => {
  network.listen({ onUnhandledFrame: "error" });
  unwrappedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    unwrappedFetch(typeof input === "string" ? new URL(input, "http://admit-one.test") : input, init);
});
afterEach(() => {
  network.resetHandlers();
});
afterAll(() => {
  globalThis.fetch = unwrappedFetch;
  network.close();
});

const soldOut = {
  type: "/problems/sold-out",
  title: "Not enough tickets left",
  status: 409,
  detail: "Only 2 left for that ticket type.",
  instance: "/api/holds",
  code: "sold_out",
  tierId: "nmj-standing",
  available: 2,
};

describe("API client", () => {
  it("turns a problem response into an ApiError carrying the typed problem", async () => {
    network.use(
      http.post("*/api/holds", () =>
        HttpResponse.json(soldOut, { status: 409, headers: { "Content-Type": PROBLEM_CONTENT_TYPE } }),
      ),
    );
    const error: unknown = await apiClient
      .createHold({ eventSlug: "night-market-jazz", items: [{ tierId: "nmj-standing", quantity: 3 }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const problem = problemOf(error);
    expect(problem?.code).toBe("sold_out");
    if (problem?.code === "sold_out") expect(problem.available).toBe(2); // narrowed by the code
  });

  it("calls a response that breaks the contract a NetworkError, not data", async () => {
    network.use(http.get("*/api/orders/:orderId", () => HttpResponse.json({ id: "ord_1", status: "teleported" })));
    await expect(apiClient.getOrder("ord_1")).rejects.toThrow(
      new NetworkError("The server’s response didn’t match the API contract."),
    );
  });

  it("calls an error without a problem body a NetworkError", async () => {
    network.use(http.get("*/api/orders/:orderId", () => new HttpResponse("Bad gateway", { status: 502 })));
    await expect(apiClient.getOrder("ord_1")).rejects.toThrow(
      new NetworkError("The server answered 502 without a problem description."),
    );
  });

  it("calls a dropped connection a NetworkError", async () => {
    network.use(http.get("*/api/orders/:orderId", () => HttpResponse.error()));
    await expect(apiClient.getOrder("ord_1")).rejects.toThrow(
      new NetworkError("Couldn’t reach the server. Check your connection and try again."),
    );
  });

  it("sends the idempotency key alongside its default headers", async () => {
    const captured: { headers: Headers | null } = { headers: null };
    network.use(
      http.post("*/api/orders/:orderId/payments", ({ request }) => {
        captured.headers = request.headers;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    await apiClient
      .createPayment("ord_1", { number: "4242", expiry: "", cvc: "", name: "" }, "key-1")
      .catch(() => null);
    expect(captured.headers?.get("Idempotency-Key")).toBe("key-1");
    expect(captured.headers?.get("Content-Type")).toBe("application/json");
  });
});
