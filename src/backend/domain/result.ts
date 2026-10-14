export type ServiceError = { status: number; code: string; message: string; details?: Record<string, unknown> };

/** The outcome of a backend operation: a value, or an error the HTTP layer can turn into a response. */
export type Result<T> = { ok: true; status: number; value: T } | { ok: false; error: ServiceError };

export const ok = <T>(value: T, status = 200): Result<T> => ({ ok: true, status, value });

export const fail = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result<never> => ({ ok: false, error: { status, code, message, details } });
