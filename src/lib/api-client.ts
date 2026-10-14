/**
 * The app's API client. Plain fetch against `/api/*` — written exactly as it would
 * be against a real backend. It knows nothing about the simulation: whoever starts
 * the app can hold requests until a dependency is ready (`setApiReadiness`).
 */
import type { ApiErrorBody, EventView, HoldResponse, LineItem, OrderView, PaymentView } from "@/contract/dto";
import type { CardInput } from "@/core/schemas";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let readiness: Promise<unknown> = Promise.resolve();

/** Hold every request until `ready` settles. Set once, at startup. */
export function setApiReadiness(ready: Promise<unknown>) {
  readiness = ready;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await readiness;
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "network_error",
      body?.error?.message ?? "Something went wrong. Please try again.",
      body?.error?.details,
    );
  }
  return body as T;
}

const post = <T>(path: string, data: unknown, headers: Record<string, string> = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(data), headers });

export type PaymentResponse = { payment: PaymentView; order: OrderView };

export const api = {
  listEvents: () => request<EventView[]>("/api/events"),
  getEvent: (slug: string) => request<EventView>(`/api/events/${slug}`),
  createHold: (eventSlug: string, items: LineItem[]) => post<HoldResponse>("/api/holds", { eventSlug, items }),
  getHold: (id: string) => request<HoldResponse>(`/api/holds/${id}`),
  upsertOrder: (holdId: string, attendees: OrderView["attendees"], addOns: Record<string, number>) =>
    post<OrderView>("/api/orders", { holdId, attendees, addOns }),
  getOrder: (id: string) => request<OrderView>(`/api/orders/${id}`),
  createPayment: (orderId: string, card: CardInput, idempotencyKey: string) =>
    post<PaymentResponse>(`/api/orders/${orderId}/payments`, card, { "Idempotency-Key": idempotencyKey }),
  confirmChallenge: (paymentId: string, approve: boolean) =>
    post<PaymentResponse>(`/api/payments/${paymentId}/challenge`, { approve }),
};
