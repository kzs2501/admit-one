// @vitest-environment node
/**
 * Only development and tests fall back to local defaults; everything else needs its
 * secrets, so a deployment can't run on a known webhook secret or the demo key.
 */
import { describe, expect, it } from "vitest";
import { DEMO_TICKET_KEY_ID } from "@/core/demo-ticket-key";
import type { TicketClaims } from "@/core/ticket-token";
import { serverConfigFrom } from "./server-config";

const CLAIMS: TicketClaims = {
  code: "AO-CONFIG-1",
  eventSlug: "open-studio-ceramics",
  attendeeName: "Asha Rao",
  tierName: "Two-hour session",
  seat: null,
};
const SECRETS = {
  DATABASE_URL: "postgres://db.example/admit",
  WEBHOOK_SECRET: "whsec_live",
  TICKET_SIGNING_KEY: "VgjR3ifEFNcI1PdhTvaCo_-w09pHOzQ9pGr8xhm6i-Q",
};
const kidOf = (token: string) => token.split(".")[1];

describe("the server's configuration", () => {
  it.each(["production", "staging", undefined])("needs every secret when NODE_ENV is %s", (nodeEnv) => {
    expect(() => serverConfigFrom({ NODE_ENV: nodeEnv })).toThrow(
      "needs DATABASE_URL, WEBHOOK_SECRET, TICKET_SIGNING_KEY",
    );
    expect(() => serverConfigFrom({ NODE_ENV: nodeEnv, ...SECRETS, WEBHOOK_SECRET: "" })).toThrow("WEBHOOK_SECRET");
  });

  it("isn't relaxed by CI being set", () => {
    expect(() => serverConfigFrom({ NODE_ENV: "production", CI: "true" })).toThrow("needs");
  });

  it("in production, signs with its own key", () => {
    const config = serverConfigFrom({ NODE_ENV: "production", ...SECRETS });
    expect(config).toMatchObject({ databaseUrl: SECRETS.DATABASE_URL, webhookSecret: SECRETS.WEBHOOK_SECRET });
    expect(kidOf(config.signTicket(CLAIMS))).toBe("server-1");
  });

  it.each(["development", "test"])("in %s, falls back to local defaults and the demo key", (nodeEnv) => {
    const config = serverConfigFrom({ NODE_ENV: nodeEnv });
    expect(config.databaseUrl).toContain("localhost");
    expect(kidOf(config.signTicket(CLAIMS))).toBe(DEMO_TICKET_KEY_ID);
  });

  it("turns the scheduler's delivery endpoint on only with CRON_SECRET", () => {
    expect(serverConfigFrom({ NODE_ENV: "production", ...SECRETS }).deliverySecret).toBeNull();
    expect(serverConfigFrom({ NODE_ENV: "production", ...SECRETS, CRON_SECRET: "cron" }).deliverySecret).toBe("cron");
  });

  it("refuses a key id tokens can't carry, at start-up rather than at the first ticket", () => {
    expect(() => serverConfigFrom({ NODE_ENV: "production", ...SECRETS, TICKET_KEY_ID: "Server 1" })).toThrow(
      "TICKET_KEY_ID",
    );
    expect(
      kidOf(serverConfigFrom({ NODE_ENV: "production", ...SECRETS, TICKET_KEY_ID: "door-2" }).signTicket(CLAIMS)),
    ).toBe("door-2");
  });
});
