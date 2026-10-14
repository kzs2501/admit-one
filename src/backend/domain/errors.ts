/**
 * Domain errors: what went wrong, in the domain's own terms — a code, a sentence for
 * the buyer, and any facts the caller needs (how many tickets are left). They are
 * exactly the problem details of the HTTP contract minus the transport members
 * (`type`, `title`, `status`, `instance`), which the HTTP layer adds. The domain never
 * picks a status code.
 */
import type { Problem } from "@/contract/problems";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type DomainError = DistributiveOmit<Problem, "type" | "title" | "status" | "instance">;

/** The outcome of a domain operation. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (error: DomainError): Result<never> => ({ ok: false, error });

export const map = <T, U>(result: Result<T>, transform: (value: T) => U): Result<U> =>
  result.ok ? ok(transform(result.value)) : result;
