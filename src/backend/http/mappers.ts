/**
 * Read models → wire DTOs. The one place epoch milliseconds become ISO 8601 strings,
 * and the place to look when the contract and the domain need to differ.
 */
import type {
  OrderPageDto,
  OrderRowDto,
  OrganiserOrderDto,
  AccountDto,
  OrganiserEventDto,
  SessionDto,
  EventDto,
  HoldDetailsDto,
  HoldDto,
  OrderDto,
  PaymentDto,
  PaymentResultDto,
  QueueEntryDto,
  SeatAvailabilityDto,
} from "@/contract/dto";
import type {
  OrderRowView,
  OrganiserOrderView,
  AccountView,
  OrganiserEventView,
  EventView,
  HoldDetailsView,
  HoldView,
  OrderView,
  PaymentResultView,
  PaymentView,
  QueueEntryView,
  SeatAvailabilityView,
} from "@/backend/domain/views";

const toIso = (epochMs: number) => new Date(epochMs).toISOString();

export const toEventDto = (event: EventView): EventDto => event;

export const toAccountDto = (account: AccountView): AccountDto => account;

export const toSessionDto = ({ token, account }: { token: string; account: AccountView }): SessionDto => ({
  token,
  account: toAccountDto(account),
});

export const toOrganiserEventDto = (event: OrganiserEventView): OrganiserEventDto => event;

export const toOrderRowDto = ({ createdAtMs, ...row }: OrderRowView): OrderRowDto => ({
  ...row,
  createdAt: toIso(createdAtMs),
});

export const toOrderPageDto = ({
  orders,
  ...page
}: {
  orders: OrderRowView[];
  nextPageToken: string | null;
  totalSize: number;
}): OrderPageDto => ({ ...page, orders: orders.map(toOrderRowDto) });

export const toOrganiserOrderDto = ({ createdAtMs, ...order }: OrganiserOrderView): OrganiserOrderDto => ({
  ...order,
  createdAt: toIso(createdAtMs),
});

function toHoldDto({ createdAtMs, expiresAtMs, ...hold }: HoldView): HoldDto {
  return { ...hold, createdAt: toIso(createdAtMs), expiresAt: toIso(expiresAtMs) };
}

export const toPaymentDto = ({ nextAction, ...payment }: PaymentView): PaymentDto => ({
  ...payment,
  nextAction:
    nextAction?.type === "upi"
      ? { type: "upi", intentUri: nextAction.intentUri, expiresAt: toIso(nextAction.expiresAtMs) }
      : nextAction,
});

export function toOrderDto({ createdAtMs, updatedAtMs, payment, ...order }: OrderView): OrderDto {
  return {
    ...order,
    payment: payment ? toPaymentDto(payment) : null,
    createdAt: toIso(createdAtMs),
    updatedAt: toIso(updatedAtMs),
  };
}

export const toHoldDetailsDto = ({ hold, event, order, serverTimeMs }: HoldDetailsView): HoldDetailsDto => ({
  hold: toHoldDto(hold),
  event: toEventDto(event),
  order: order ? toOrderDto(order) : null,
  serverTime: toIso(serverTimeMs),
});

export const toPaymentResultDto = ({ payment, order }: PaymentResultView): PaymentResultDto => ({
  payment: toPaymentDto(payment),
  order: toOrderDto(order),
});

export const toSeatAvailabilityDto = ({
  serverTimeMs,
  ...availability
}: SeatAvailabilityView): SeatAvailabilityDto => ({
  ...availability,
  serverTime: toIso(serverTimeMs),
});

/** Durations go out as whole seconds, rounded up: "about 3 seconds" should never become 2. */
const toSeconds = (ms: number) => Math.ceil(ms / 1000);

export const toQueueEntryDto = ({
  estimatedWaitMs,
  checkAgainAfterMs,
  admittedUntilMs,
  serverTimeMs,
  ...entry
}: QueueEntryView): QueueEntryDto => ({
  ...entry,
  estimatedWaitSeconds: toSeconds(estimatedWaitMs),
  checkAgainAfterSeconds: toSeconds(checkAgainAfterMs),
  admittedUntil: admittedUntilMs === null ? null : toIso(admittedUntilMs),
  serverTime: toIso(serverTimeMs),
});
