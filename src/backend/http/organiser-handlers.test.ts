// @vitest-environment node
/**
 * The organisers' API contract: who's signed in, and the difference between 401, 403
 * and 404, as a client sees it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "@/backend/domain/access";
import { BASE_URL, createHttpHarness, expectProblem } from "@/backend/testing/http";
import { accountDtoSchema, organiserEventDtoSchema, sessionDtoSchema } from "@/contract/dto";

const { server, clock, call, post, bearer } = createHttpHarness();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

async function signIn(accountId: string) {
  const response = await post("/api/session", { accountId });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return sessionDtoSchema.parse(await response.json());
}

describe("organisers' API", () => {
  it("signs in as a demo account, and refuses one that doesn't exist", async () => {
    const { account } = await signIn("acc-lakeside-owner");
    expect(account).toMatchObject({ role: "owner", organisation: { id: "lakeside-live" } });
    await expectProblem(await post("/api/session", { accountId: "acc-nobody" }), 422, "invalid_request");
  });

  it("answers 401 without a token, and says the token is invalid once it's signed out or expired", async () => {
    const missing = await call("/api/organiser/account");
    await expectProblem(missing, 401, "unauthenticated");
    expect(missing.headers.get("WWW-Authenticate")).toBe('Bearer realm="admit-one"');
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const { token } = await signIn("acc-lakeside-owner");
    const me = await call("/api/organiser/account", { headers: bearer(token) });
    expect(accountDtoSchema.parse(await me.json()).name).toBe("Nandini Rao");
    // The scheme is case-insensitive.
    expect((await call("/api/organiser/account", { headers: { Authorization: `bearer ${token}` } })).status).toBe(200);

    expect((await call("/api/session", { method: "DELETE", headers: bearer(token) })).status).toBe(204);
    expect((await call("/api/session", { method: "DELETE", headers: bearer(token) })).status).toBe(204);
    const signedOut = await call("/api/organiser/account", { headers: bearer(token) });
    await expectProblem(signedOut, 401, "unauthenticated");
    expect(signedOut.headers.get("WWW-Authenticate")).toBe('Bearer realm="admit-one", error="invalid_token"');

    const { token: later } = await signIn("acc-lakeside-owner");
    clock.advance(SESSION_TTL_MS);
    await expectProblem(await call("/api/organiser/account", { headers: bearer(later) }), 401, "unauthenticated");
  });

  it("lists only the account's own events, and forbids another organiser's", async () => {
    const { token } = await signIn("acc-rangmanch-owner");
    const events = organiserEventDtoSchema
      .array()
      .parse(await (await call("/api/organiser/events", { headers: bearer(token) })).json());
    expect(events.map((event) => event.slug)).toEqual(["open-studio-ceramics", "monsoon-strings"]);

    const theirs = await call("/api/organiser/events/lakeside-lights", { headers: bearer(token) });
    const problem = await expectProblem(theirs, 403, "forbidden");
    expect(problem.instance).toBe(`${BASE_URL}/api/organiser/events/lakeside-lights`);
    await expectProblem(await call("/api/organiser/events/nope", { headers: bearer(token) }), 404, "not_found");
    const own = await call("/api/organiser/events/monsoon-strings", { headers: bearer(token) });
    expect(organiserEventDtoSchema.parse(await own.json()).permissions).toContain("orders:refund");
  });
});
