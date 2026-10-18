/**
 * Chaos PRESETS: each one bends the simulated backend in a specific way so a visitor
 * can watch the checkout handle it. A preset is only configuration — the code paths
 * it exercises are the same ones a real backend would take.
 */
/** A waiting room in front of every sale: who's ahead when you join, and how fast the line moves. */
export interface WaitingRoomConfig {
  aheadAtJoin: number;
  /** People let in at each step, every `batchIntervalMs`. */
  admittedPerBatch: number;
  batchIntervalMs: number;
  /** How long an admitted visitor has to reserve before their turn passes. */
  admissionWindowMs: number;
}

export interface ChaosConfig {
  /** Network latency for every request: [min, max]. */
  latencyRangeMs: readonly [number, number];
  /** Extra latency on the payment request only. */
  extraPaymentLatencyMs: number;
  /** How long a hold lasts. */
  holdDurationMs: number;
  /** When the payment provider's webhook arrives, after the payment succeeds. */
  webhookDelayMs: number;
  /** Deliver the same webhook event twice. */
  shouldDuplicateWebhook: boolean;
  /** Override the card's outcome. */
  forcedOutcome: "decline" | "challenge" | null;
  /** Simulate a buyer who starts paying with seconds left on the clock. */
  shouldExpireHoldDuringPayment: boolean;
  /** Other buyers compete for the same tickets. */
  isCrowdEnabled: boolean;
  /** Lose the response to an order's first charge: the server did the work, the browser never hears. */
  shouldDropFirstPaymentResponse: boolean;
  /** Lose this many order-status responses after the first, as a flaky connection would. */
  droppedStatusChecks: number;
  /** Another buyer takes one of the seats you ask for, a moment first (once). */
  shouldSnatchRequestedSeat: boolean;
  /** How many reservation attempts one client may make per window. */
  holdRateLimit: { limit: number; windowMs: number };
  /** A high-demand sale: everyone queues before they can reserve. */
  waitingRoom: WaitingRoomConfig | null;
}

export const PRESET_IDS = [
  "happy",
  "declined",
  "challenge",
  "slow-network",
  "connection-drops",
  "webhook-twice",
  "webhook-first",
  "webhook-delayed",
  "hold-expires",
  "crowd",
  "seat-snatched",
  "too-many-attempts",
  "flash-sale",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  id: PresetId;
  label: string;
  /** What the preset does, in one sentence. */
  description: string;
  /** What a correct checkout does about it — and what the e2e test asserts. */
  expectation: string;
  config: ChaosConfig;
}

export const DEFAULT_CHAOS: ChaosConfig = {
  latencyRangeMs: [180, 420],
  extraPaymentLatencyMs: 300,
  holdDurationMs: 5 * 60_000,
  webhookDelayMs: 1_500,
  shouldDuplicateWebhook: false,
  forcedOutcome: null,
  shouldExpireHoldDuringPayment: false,
  isCrowdEnabled: false,
  shouldDropFirstPaymentResponse: false,
  droppedStatusChecks: 0,
  shouldSnatchRequestedSeat: false,
  // Generous: a buyer never meets it; a script hammering the endpoint does.
  holdRateLimit: { limit: 20, windowMs: 60_000 },
  waitingRoom: null,
};

type PresetDefinition = Omit<Preset, "id" | "config"> & { config?: Partial<ChaosConfig> };

/** Keyed by id, so every preset id has exactly one definition — the compiler checks it. */
const DEFINITIONS: Record<PresetId, PresetDefinition> = {
  happy: {
    label: "Happy path",
    description: "Everything works, with realistic latency.",
    expectation: "Confirming… for about a second, then your tickets.",
  },
  declined: {
    label: "Declined card",
    description: "The bank declines whatever card you use.",
    expectation: "An inline error, your details kept, and the chance to try another card.",
    config: { forcedOutcome: "decline" },
  },
  challenge: {
    label: "3-D Secure",
    description: "The bank asks you to authenticate the payment.",
    expectation: "An authentication dialog. Approve and the order completes; fail and you can try again.",
    config: { forcedOutcome: "challenge" },
  },
  "slow-network": {
    label: "Slow network",
    description: "Every request takes around three seconds.",
    expectation: "Loading states everywhere, no double submissions, nothing jumps around.",
    config: { latencyRangeMs: [2_600, 3_400], extraPaymentLatencyMs: 0 },
  },
  "connection-drops": {
    label: "Connection drops",
    description:
      "The server takes your payment, but its answer is lost on the way back — and a few status checks fail.",
    expectation:
      "Paying again is safe: the same Idempotency-Key replays the first answer, so you’re charged once. While status checks fail, the order page keeps what it knows and says so.",
    config: { shouldDropFirstPaymentResponse: true, droppedStatusChecks: 3, webhookDelayMs: 8_000 },
  },
  "webhook-twice": {
    label: "Webhook arrives twice",
    description: "The payment provider delivers the same webhook event twice.",
    expectation: "One set of tickets. The server log shows the duplicate being ignored.",
    config: { shouldDuplicateWebhook: true },
  },
  "webhook-first": {
    label: "Webhook before redirect",
    description: "The webhook lands before your browser gets the payment response.",
    expectation: "The order page opens already confirmed — the redirect isn’t the source of truth.",
    config: { webhookDelayMs: 0, extraPaymentLatencyMs: 1_800 },
  },
  "webhook-delayed": {
    label: "Webhook delayed",
    description: "The provider takes twelve seconds to send the webhook.",
    expectation: "Confirming… with polling that backs off, then a reassuring note, then your tickets.",
    config: { webhookDelayMs: 12_000 },
  },
  "hold-expires": {
    label: "Hold expires mid-payment",
    description: "You start paying with three seconds left, and the bank is slower than that.",
    expectation: "The payment succeeds after your hold is gone, so the order is refunded and explained.",
    config: { shouldExpireHoldDuringPayment: true, webhookDelayMs: 6_000 },
  },
  crowd: {
    label: "Crowd buys the last ticket",
    description: "Other buyers grab nearly-sold-out tickets moments before you.",
    expectation: "“Someone just got the last tickets” with live availability, never an oversold event.",
    config: { isCrowdEnabled: true },
  },
  "seat-snatched": {
    label: "Seat snatched",
    description: "Another buyer takes one of the seats you chose, a moment before you reserve them.",
    expectation: "Nothing is held: the map names the seat that went and keeps the rest of your choice.",
    config: { shouldSnatchRequestedSeat: true },
  },
  "too-many-attempts": {
    label: "Too many attempts",
    description: "Reserving is limited to three tries every 15 seconds, the way a box office slows bots down.",
    expectation:
      "The fourth try is refused with a 429; Reserve waits out the countdown the server asked for, then works again.",
    config: { holdRateLimit: { limit: 3, windowMs: 15_000 } },
  },
  "flash-sale": {
    label: "Flash sale",
    description: "40,000 people (simulated) want tickets at once; a waiting room lets them in 8,000 at a time.",
    expectation:
      "You join the queue and see your place and an honest wait; a refresh keeps your place; when it’s your turn, you have 10 minutes to reserve.",
    config: {
      waitingRoom: {
        aheadAtJoin: 40_000,
        admittedPerBatch: 8_000,
        batchIntervalMs: 2_000,
        admissionWindowMs: 10 * 60_000,
      },
    },
  },
};

const toPreset = (id: PresetId): Preset => {
  const { config, ...definition } = DEFINITIONS[id];
  return { id, ...definition, config: { ...DEFAULT_CHAOS, ...config } };
};

/** In display order. */
export const PRESETS: readonly Preset[] = PRESET_IDS.map(toPreset);

export const getPreset = (id: PresetId): Preset => toPreset(id);
