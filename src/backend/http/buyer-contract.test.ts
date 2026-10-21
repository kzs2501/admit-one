// @vitest-environment node
import { getResponse } from "msw";
import { createTestBackend } from "@/backend/testing/fixtures";
import { describeBuyerContract } from "@/backend/testing/buyer-contract";
import { createHandlers } from "./handlers";

/** The buyer's contract on the browser sandbox; `postgres/contract.test.ts` runs it on the server. */
describeBuyerContract("the browser sandbox", () => {
  const { backend, clock } = createTestBackend();
  const handlers = createHandlers(backend, { sleep: () => Promise.resolve(), random: () => 0, now: clock.now });
  return {
    send: async (request) => {
      const response = await getResponse(handlers, request);
      if (!response) throw new Error(`No handler for ${request.method} ${request.url}`);
      return response;
    },
    advance: clock.advance,
    settle: () => {
      backend.deliverDue();
      return Promise.resolve();
    },
  };
});
