/**
 * Read models → wire DTOs. The one place epoch milliseconds become ISO 8601 strings,
 * and the place to look when the contract and the domain need to differ.
 */
import type { EventDto, HoldDetailsDto, HoldDto, OrderDto, PaymentResultDto } from "@/contract/dto";
import type { EventView, HoldDetailsView, HoldView, OrderView, PaymentResultView } from "@/backend/domain/views";

const toIso = (epochMs: number) => new Date(epochMs).toISOString();

export const toEventDto = (event: EventView): EventDto => event;

function toHoldDto({ createdAtMs, expiresAtMs, ...hold }: HoldView): HoldDto {
  return { ...hold, createdAt: toIso(createdAtMs), expiresAt: toIso(expiresAtMs) };
}

export function toOrderDto({ createdAtMs, updatedAtMs, ...order }: OrderView): OrderDto {
  return { ...order, createdAt: toIso(createdAtMs), updatedAt: toIso(updatedAtMs) };
}

export const toHoldDetailsDto = ({ hold, event, order, serverTimeMs }: HoldDetailsView): HoldDetailsDto => ({
  hold: toHoldDto(hold),
  event: toEventDto(event),
  order: order ? toOrderDto(order) : null,
  serverTime: toIso(serverTimeMs),
});

export const toPaymentResultDto = ({ payment, order }: PaymentResultView): PaymentResultDto => ({
  payment,
  order: toOrderDto(order),
});
