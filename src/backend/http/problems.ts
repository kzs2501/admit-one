/**
 * Domain errors → RFC 9457 problem details. The domain says what went wrong; this
 * adds how HTTP expresses it: the status, the title, and absolute `type` and `instance`
 * URIs (as RFC 9457 recommends).
 */
import { PROBLEM_CATALOG, problemTypeFor, type ProblemDocument } from "@/contract/problems";
import type { DomainError } from "@/backend/domain/errors";

/** `requestUrl` becomes the problem's `instance`; its origin anchors the `type` URI. */
export function toProblem(error: DomainError, requestUrl: string): ProblemDocument {
  const { status, title } = PROBLEM_CATALOG[error.code];
  const type = problemTypeFor(error.code, new URL(requestUrl).origin);
  return { ...error, type, title, status, instance: requestUrl };
}
