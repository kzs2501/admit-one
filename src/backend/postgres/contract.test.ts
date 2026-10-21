import { afterAll, beforeAll } from "vitest";
import { createServerApi } from "@/backend/server";
import { describeBuyerContract } from "@/backend/testing/buyer-contract";
import { createTestDatabase } from "./testing/database";
import { signDemoTicket } from "@/core/demo-ticket-key";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let nowMs = Date.UTC(2026, 9, 21, 6, 30);
let idCount = 0;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.drop());

/** The buyer's contract on the server, on Postgres: the same tests the sandbox passes. */
describeBuyerContract("the server, on Postgres", () => {
  // Each test starts a hold's length on, so nothing from the last one is still live.
  nowMs += 10 * 60_000;
  const api = createServerApi(
    database.db,
    {
      now: () => nowMs,
      newId: (prefix) => `${prefix}_${String(++idCount)}`,
      random: () => 0,
      signTicket: signDemoTicket,
    },
    { webhookSecret: "whsec_contract" },
  );
  return {
    send: (request) => api.handle(request),
    advance: (ms) => {
      nowMs += ms;
    },
    settle: async () => {
      await api.deliverDueWebhooks();
    },
  };
});
