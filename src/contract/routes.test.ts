// @vitest-environment node
import { describe, expect, it } from "vitest";
import { API_ROUTES, buildApiPath } from "./routes";

describe("API routes", () => {
  it("fills in params, URL-encoding them", () => {
    expect(buildApiPath(API_ROUTES.createPayment, { orderId: "ord_1" })).toBe("/api/orders/ord_1/payments");
    expect(buildApiPath(API_ROUTES.getEvent, { slug: "a b/c" })).toBe("/api/events/a%20b%2Fc");
    expect(buildApiPath(API_ROUTES.listEvents, {})).toBe("/api/events");
  });
});
