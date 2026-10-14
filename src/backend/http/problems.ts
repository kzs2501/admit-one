/**
 * Domain errors → RFC 9457 problem details. The domain says what went wrong; this
 * adds how HTTP expresses it: the status, the title and the `type` URI.
 */
import { PROBLEM_CATALOG, problemTypeFor, type Problem } from "@/contract/problems";
import type { DomainError } from "@/backend/domain/errors";

export function toProblem(error: DomainError, instance: string): Problem {
  const { status, title } = PROBLEM_CATALOG[error.code];
  return { ...error, type: problemTypeFor(error.code), title, status, instance };
}
