/**
 * Chaos presets: each one bends the simulated server in a specific way so a visitor
 * can watch the checkout handle it. A preset is only configuration — the code paths
 * it exercises are the same ones a real backend would take.
 */
export type ChaosConfig = {
  /** Network latency for every request, ms [min, max]. */
  latencyMs: [number, number];
  /** Extra latency on the payment request only, ms. */
  paymentLatencyMs: number;
  /** How long a hold lasts. */
  holdSeconds: number;
  /** When the payment provider's webhook arrives, after the payment succeeds. */
  webhookDelayMs: number;
  /** Deliver the same webhook event twice. */
  duplicateWebhook: boolean;
  /** Override the card's outcome. */
  forceOutcome: "decline" | "challenge" | null;
  /** Simulate a buyer who starts paying with seconds left on the clock. */
  expireHoldDuringPayment: boolean;
  /** Other buyers compete for the same tickets. */
  crowd: boolean;
};

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

export type Preset = {
  id: PresetId;
  label: string;
  /** What the preset does, in one sentence. */
  description: string;
  /** What a correct checkout does about it — and what the e2e test asserts. */
  expectation: string;
  config: ChaosConfig;
};

export const DEFAULT_CHAOS: ChaosConfig = {
  latencyMs: [180, 420],
  paymentLatencyMs: 300,
  holdSeconds: 300,
  webhookDelayMs: 1500,
  duplicateWebhook: false,
  forceOutcome: null,
  expireHoldDuringPayment: false,
  crowd: false,
};

const preset = (p: Omit<Preset, "config"> & { config?: Partial<ChaosConfig> }): Preset => ({
  ...p,
  config: { ...DEFAULT_CHAOS, ...p.config },
});

export const presets: Preset[] = [
  preset({
    id: "happy",
    label: "Happy path",
    description: "Everything works, with realistic latency.",
    expectation: "Confirming… for about a second, then your tickets.",
  }),
  preset({
    id: "declined",
    label: "Declined card",
    description: "The bank declines whatever card you use.",
    expectation: "An inline error, your details kept, and the chance to try another card.",
    config: { forceOutcome: "decline" },
  }),
  preset({
    id: "challenge",
    label: "3-D Secure",
    description: "The bank asks you to authenticate the payment.",
    expectation: "An authentication dialog. Approve and the order completes; fail and you can try again.",
    config: { forceOutcome: "challenge" },
  }),
  preset({
    id: "slow-network",
    label: "Slow network",
    description: "Every request takes around three seconds.",
    expectation: "Loading states everywhere, no double submissions, nothing jumps around.",
    config: { latencyMs: [2600, 3400], paymentLatencyMs: 0 },
  }),
  preset({
    id: "webhook-twice",
    label: "Webhook arrives twice",
    description: "The payment provider delivers the same webhook event twice.",
    expectation: "One set of tickets. The server log shows the duplicate being ignored.",
    config: { duplicateWebhook: true },
  }),
  preset({
    id: "webhook-first",
    label: "Webhook before redirect",
    description: "The webhook lands before your browser gets the payment response.",
    expectation: "The order page opens already confirmed — the redirect isn’t the source of truth.",
    config: { webhookDelayMs: 0, paymentLatencyMs: 1800 },
  }),
  preset({
    id: "webhook-delayed",
    label: "Webhook delayed",
    description: "The provider takes twelve seconds to send the webhook.",
    expectation: "Confirming… with polling that backs off, then a reassuring note, then your tickets.",
    config: { webhookDelayMs: 12000 },
  }),
  preset({
    id: "hold-expires",
    label: "Hold expires mid-payment",
    description: "You start paying with three seconds left, and the bank is slower than that.",
    expectation: "The payment succeeds after your hold is gone, so the order is refunded and explained.",
    config: { expireHoldDuringPayment: true, webhookDelayMs: 6000 },
  }),
  preset({
    id: "crowd",
    label: "Crowd buys the last ticket",
    description: "Other buyers grab nearly-sold-out tickets moments before you.",
    expectation: "“Someone just got the last tickets” with live availability, never an oversold event.",
    config: { crowd: true },
  }),
];

export const getPreset = (id: PresetId) => presets.find((p) => p.id === id) ?? presets[0];
