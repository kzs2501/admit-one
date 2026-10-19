/**
 * What every handler needs: simulated latency, problem replies, sending with a line in
 * the server log, and body parsing. The shop's API and the organisers' share it, so
 * both answer the same way.
 */
import { HttpResponse } from "msw/http";
import type { z } from "@/core/zod";
import type { Backend } from "@/backend/backend";
import type { DomainError, Result } from "@/backend/domain/errors";
import type { JsonValue } from "@/backend/domain/state";
import { PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import { toProblem } from "./problems";

export interface HandlerOptions {
  /** Wait helper — real timers in the browser, instant in tests. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** The adapter's clock, for rate limiting. */
  now: () => number;
}

/** A response before it's sent: a status, a JSON body (a DTO or a problem), and any extra headers. */
export interface Reply {
  status: number;
  body: JsonValue;
  headers?: Record<string, string>;
}

// `*/api/...` matches any origin, so the same handlers work in the browser and in
// Node-based tests.
export const anyOrigin = (route: string) => `*${route}`;

export const pathOf = (request: Request) => new URL(request.url).pathname;

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function createKit(backend: Backend, { sleep, random }: Pick<HandlerOptions, "sleep" | "random">) {
  const latency = (extraMs = 0) => {
    const [minMs, maxMs] = backend.chaos().latencyRangeMs;
    return sleep(minMs + random() * (maxMs - minMs) + extraMs);
  };

  const problemReply = (error: DomainError, request: Request): Reply => {
    const problem = toProblem(error, request.url);
    return { status: problem.status, body: problem };
  };

  const resultReply = <T>(result: Result<T>, request: Request, toBody: (value: T) => JsonValue, status = 200): Reply =>
    result.ok ? { status, body: toBody(result.value) } : problemReply(result.error, request);

  const send = (request: Request, { status, body, headers = {} }: Reply) => {
    backend.log("request", `${request.method} ${pathOf(request)} → ${String(status)}`);
    return status >= 400
      ? HttpResponse.json(body, { status, headers: { ...headers, "Content-Type": PROBLEM_CONTENT_TYPE } })
      : HttpResponse.json(body, { status, headers });
  };

  /** An answer with no body, such as a 204. */
  const sendEmpty = (request: Request, status: number) => {
    backend.log("request", `${request.method} ${pathOf(request)} → ${String(status)}`);
    return new HttpResponse(null, { status });
  };

  /**
   * Parse a request body against its schema — or, for an endpoint that takes more than
   * one shape, the schema for the shape it is. A body that doesn't parse is the
   * client's problem.
   */
  async function parseBody<Schema extends z.ZodType>(
    request: Request,
    schemaFor: Schema | ((body: unknown) => Schema),
  ): Promise<{ ok: true; value: z.output<Schema> } | { ok: false; reply: Reply }> {
    const body = await readJson(request);
    const schema = typeof schemaFor === "function" ? schemaFor(body) : schemaFor;
    const parsed = schema.safeParse(body);
    if (parsed.success) return { ok: true, value: parsed.data };
    const detail = parsed.error.issues[0]?.message ?? "The request body is invalid.";
    return { ok: false, reply: problemReply({ code: "invalid_request", detail }, request) };
  }

  return { latency, problemReply, resultReply, send, sendEmpty, parseBody };
}

export type Kit = ReturnType<typeof createKit>;
