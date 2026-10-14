/**
 * Chaos PRESETS: each one bends the simulated backend in a specific way so a visitor
 * can watch the checkout handle it. A preset is only configuration — the code paths
 * it exercises are the same ones a real backend would take.
 */
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
}

export const PRESET_IDS = [
  "happy",
  "declined",
  "challenge",
  "slow-network",
  "webhook-twice",
  "webhook-first",
  "webhook-delayed",
  "hold-expires",
  "crowd",
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
};

const toPreset = (id: PresetId): Preset => {
  const { config, ...definition } = DEFINITIONS[id];
  return { id, ...definition, config: { ...DEFAULT_CHAOS, ...config } };
};

/** In display order. */
export const PRESETS: readonly Preset[] = PRESET_IDS.map(toPreset);

export const getPreset = (id: PresetId): Preset => toPreset(id);
