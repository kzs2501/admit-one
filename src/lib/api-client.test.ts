// @vitest-environment node
/**
 * The client is the boundary between the network and the UI: these tests check that
 * whatever comes back — a valid answer, a problem, garbage or nothing — becomes a
 * typed value or one of exactly two typed errors.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import {
  apiClient,
  ApiError,
  NetworkError,
  parseRetryAfter,
  problemOf,
  setApiReadiness,
  setApiRecovery,
  setRequestTimeout,
} from "./api-client";

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
  type: "http://localhost/problems/sold-out",
  title: "Not enough tickets left",
  status: 409,
  detail: "Only 2 left for that ticket type.",
  instance: "http://localhost/api/holds",
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

  it("carries a 429's Retry-After, so the caller knows exactly how long to wait", async () => {
    network.use(
      http.post("*/api/holds", () =>
        HttpResponse.json(
          {
            type: "http://localhost/problems/rate-limited",
            title: "Too many attempts",
            status: 429,
            detail: "Too many reservation attempts. Try again in 13 seconds.",
            code: "rate_limited",
            retryAfterSeconds: 13,
          },
          { status: 429, headers: { "Content-Type": PROBLEM_CONTENT_TYPE, "Retry-After": "13" } },
        ),
      ),
    );
    const error = await apiClient
      .createHold({ eventSlug: "open-studio-ceramics", items: [{ tierId: "osc-session", quantity: 1 }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ retryAfterMs: 13_000, problem: { code: "rate_limited" } });
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

describe("parseRetryAfter", () => {
  const NOW = Date.parse("2026-10-19T10:00:00Z");

  it("reads delay-seconds and HTTP-dates, as RFC 9110 allows", () => {
    expect(parseRetryAfter("13", NOW)).toBe(13_000);
    expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
    expect(parseRetryAfter("Mon, 19 Oct 2026 10:00:30 GMT", NOW)).toBe(30_000);
    expect(parseRetryAfter("Mon, 19 Oct 2026 09:59:00 GMT", NOW)).toBe(0); // already passed
  });

  it("ignores what it can't read, rather than guessing", () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter("soon", NOW)).toBeNull();
    expect(parseRetryAfter("-5", NOW)).toBeNull();
  });
});

describe("when the sandbox's backend has gone away", () => {
  const restarting = () =>
    HttpResponse.json(
      {
        type: "http://admit-one.test/problems/backend-restarting",
        title: "The demo’s backend is starting again",
        status: 503,
        detail: "The sandbox’s backend wasn’t answering in this browser.",
        code: "backend_restarting",
      },
      { status: 503, headers: { "Content-Type": PROBLEM_CONTENT_TYPE } },
    );

  afterEach(() => {
    setApiRecovery(null);
  });

  it("starts it again, once for requests that fail together, and sends each request again", async () => {
    let isUp = false;
    network.use(http.get("*/api/events", () => (isUp ? HttpResponse.json([]) : restarting())));
    let recoveries = 0;
    setApiRecovery(() => {
      recoveries += 1;
      isUp = true;
      return Promise.resolve();
    });
    expect(await Promise.all([apiClient.listEvents(), apiClient.listEvents()])).toEqual([[], []]);
    expect(recoveries).toBe(1);
  });

  it("tries only once, then says what happened", async () => {
    network.use(http.get("*/api/events", restarting));
    setApiRecovery(() => Promise.resolve());
    await expect(apiClient.listEvents()).rejects.toMatchObject({ problem: { code: "backend_restarting" } });
  });

  it("without a way to recover, says what happened", async () => {
    network.use(http.get("*/api/events", restarting));
    await expect(apiClient.listEvents()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("when the server is slow, or the backend never starts", () => {
  afterEach(() => {
    setRequestTimeout(15_000);
    setApiReadiness(Promise.resolve());
  });

  it("gives up on a request with no answer in time, as a network failure that says so", async () => {
    setRequestTimeout(50);
    network.use(
      http.get("*/api/events", async () => {
        await delay(1_000);
        return HttpResponse.json([]);
      }),
    );
    const error = await apiClient.listEvents().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("took too long");
  });

  it("says in words when the backend couldn't start, not in the library's", async () => {
    const failed = Promise.reject(new Error("[MSW] Failed to register the Service Worker"));
    failed.catch(() => undefined);
    setApiReadiness(failed);
    const error = await apiClient.listEvents().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("couldn’t start in this browser");
  });
});
