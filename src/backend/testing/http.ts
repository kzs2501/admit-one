/**
 * Test fixtures for the HTTP contract: a backend on a fake clock behind the real
 * handlers, reached with real `fetch` calls through MSW. Only tests import this.
 */
import { setupServer } from "msw/node";
import { expect } from "vitest";
import type { PresetId } from "@/backend/chaos/presets";
import { createHandlers } from "@/backend/http/handlers";
import { PROBLEM_CONTENT_TYPE, problemSchema } from "@/contract/problems";
import { AUTHORIZATION_HEADER } from "@/contract/routes";
import { createTestBackend } from "./fixtures";

export const BASE_URL = "http://dresscircle.test";

export function createHttpHarness(presetId: PresetId = "happy") {
  const { backend, clock } = createTestBackend(presetId);
  const server = setupServer(
    ...createHandlers(backend, { sleep: () => Promise.resolve(), random: () => 0, now: clock.now }),
  );

  const call = (path: string, init: RequestInit = {}) => fetch(BASE_URL + path, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    });
  const bearer = (token: string) => ({ [AUTHORIZATION_HEADER]: `Bearer ${token}` });

  return { backend, clock, server, call, post, bearer };
}

/** Assert an RFC 9457 response and return its parsed problem. */
export async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toContain(PROBLEM_CONTENT_TYPE);
  const problem = problemSchema.parse(await response.json());
  expect(problem).toMatchObject({ status, code, type: `${BASE_URL}/problems/${code.replaceAll("_", "-")}` });
  return problem;
}
