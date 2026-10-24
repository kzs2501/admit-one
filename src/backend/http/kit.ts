/**
 * What every handler needs: simulated latency, problem replies, sending with a line in
 * the server log, and body parsing. The shop's API and the organisers' share it, so
 * both answer the same way.
 */
import { HttpResponse } from "msw/http";
import type { z } from "@/core/zod";
import type { Awaitable, KitPort } from "@/backend/port";
import type { DomainError, Result } from "@/backend/domain/errors";
import type { JsonValue } from "@/backend/domain/state";
import { PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import { IDEMPOTENCY_KEY_HEADER } from "@/contract/routes";
import { fingerprintRequest } from "./idempotency";
import { toProblem } from "./problems";

export interface HandlerOptions {
  /** Wait helper — real timers in the browser, instant in tests. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** The adapter's clock, for rate limiting. */
  now: () => number;
  /** The server's key for request fingerprints (`idempotency.ts`); the sandbox has none. */
  fingerprintSecret?: string | null;
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

/** More than any request to this API needs: a bigger body isn't read. */
export const MAX_BODY_BYTES = 64 * 1024;

const isTooLarge = (request: Request) => Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES;

/** A request's body as text, unless it's over `MAX_BODY_BYTES` (then null). */
/**
 * A request's body as text, or null if it's over the limit. A body that says it's too
 * large isn't read at all; one sent in chunks, with no length to say so, is read only
 * until it passes the limit, then cancelled — never held whole in memory first.
 */
export async function readText(request: Request): Promise<string | null> {
  if (isTooLarge(request)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done: isDone, value } = await reader.read();
    if (isDone) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      // Not awaited: a cloned request's body is teed, and cancelling one branch only
      // settles once the other is cancelled too (MSW keeps a clone).
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type JsonBody = { ok: true; value: unknown } | { ok: false };

/** A request's JSON body (undefined if it isn't JSON), unless it's too large to read. */
export async function readJson(request: Request): Promise<JsonBody> {
  const text = await readText(request);
  if (text === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: true, value: undefined };
  }
}

const TOO_LARGE = {
  code: "payload_too_large",
  detail: `The request body is over ${String(MAX_BODY_BYTES / 1024)} KB.`,
} as const;

export function createKit(
  backend: KitPort,
  { sleep, random, fingerprintSecret = null }: Pick<HandlerOptions, "sleep" | "random" | "fingerprintSecret">,
) {
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

  /** A text answer, such as a CSV file. */
  const sendText = (request: Request, text: string, headers: Record<string, string>) => {
    backend.log("request", `${request.method} ${pathOf(request)} → 200`);
    return new HttpResponse(text, { status: 200, headers });
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
    const read = await readJson(request);
    if (!read.ok) return { ok: false, reply: problemReply(TOO_LARGE, request) };
    const body = read.value;
    const schema = typeof schemaFor === "function" ? schemaFor(body) : schemaFor;
    const parsed = schema.safeParse(body);
    if (parsed.success) return { ok: true, value: parsed.data };
    const detail = parsed.error.issues[0]?.message ?? "The request body is invalid.";
    return { ok: false, reply: problemReply({ code: "invalid_request", detail }, request) };
  }

  /**
   * Do something that mustn't happen twice — a charge, a refund — at most once per
   * Idempotency-Key, as Stripe describes in "Designing robust and predictable APIs with
   * idempotency". The same key and request always get the first answer back; the same
   * key with a different request is refused. Only attempted work is stored, so a request
   * turned away before anything happened can be retried with the same key once it's
   * fixed. Keys are kept for 24 hours, and an organiser's are theirs alone (`scope`).
   */
  async function withIdempotencyKey(
    request: Request,
    { what, scope = "" }: { what: string; scope?: string },
    attempt: (body: unknown) => Awaitable<{ reply: Reply; isAttempted: boolean }>,
  ): Promise<Reply> {
    const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
    if (!key) {
      return problemReply(
        { code: "missing_idempotency_key", detail: `${what} need an Idempotency-Key header.` },
        request,
      );
    }
    const read = await readJson(request);
    if (!read.ok) return problemReply(TOO_LARGE, request);
    const body = read.value;
    const fingerprint = await fingerprintRequest(request.method, pathOf(request), body, fingerprintSecret);
    const storedKey = scope ? `${scope}:${key}` : key;
    // Claim the key before doing anything, so a retry that arrives mid-request can't
    // start the same work again.
    const claim = await backend.idempotency.claim(storedKey, fingerprint);
    if (claim.kind !== "claimed") {
      const claimedFingerprint = claim.kind === "stored" ? claim.record.fingerprint : claim.fingerprint;
      if (claimedFingerprint !== fingerprint) {
        return problemReply(
          { code: "idempotency_key_reused", detail: "That Idempotency-Key was used for a different request." },
          request,
        );
      }
      if (claim.kind === "in-flight") {
        return problemReply(
          {
            code: "idempotency_key_in_use",
            detail: "A request with this Idempotency-Key is still being handled. Try again in a moment.",
          },
          request,
        );
      }
      backend.log("payment", "Idempotency-Key replayed — returning the original response, nothing done twice.");
      return { status: claim.record.status, body: claim.record.body };
    }
    try {
      const { reply, isAttempted } = await attempt(body);
      if (isAttempted) {
        await backend.idempotency.complete(storedKey, claim.token, { fingerprint, ...reply });
      } else {
        await backend.idempotency.release(storedKey, claim.token);
      }
      return reply;
    } catch (error) {
      await backend.idempotency.release(storedKey, claim.token);
      throw error;
    }
  }

  return { latency, problemReply, resultReply, send, sendText, sendEmpty, parseBody, withIdempotencyKey };
}

export type Kit = ReturnType<typeof createKit>;
