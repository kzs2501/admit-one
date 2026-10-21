/**
 * The simulated backend's public API — the only module the app may import from
 * `backend/` (lint enforces it). Nothing heavy loads up front: MSW and the domain
 * arrive through dynamic imports when the backend starts.
 *
 * Swapping in a real backend means deleting `backend/` and the line in
 * `instrumentation-client.ts` that starts it. The app talks to `/api/*` either way.
 */
import type { PresetId } from "./chaos/presets";
import type { LogEntry } from "./domain/state";
import type { WorkerLocation } from "./runtime/worker";

export { PRESETS, type Preset, type PresetId } from "./chaos/presets";
export type { LogEntry, LogKind } from "./domain/state";
export type { WorkerLocation } from "./runtime/worker";

/** A UPI request as the buyer's phone shows it. */
export interface PendingUpiRequest {
  paymentId: string;
  payeeName: string;
  amountMinor: number;
  expiresAtMs: number;
}

/**
 * What the sandbox's own controls may do to it: watch it, pick a scenario, read the log,
 * reset it — and play the buyer's phone, answering a UPI request the way the buyer's
 * own UPI app would, outside the merchant's API.
 */
export interface SandboxControl {
  subscribe: (listener: () => void) => () => void;
  /** Changes on every update — the sandbox mutates in place, so watch this. */
  getVersion: () => number;
  getPresetId: () => PresetId;
  setPreset: (id: PresetId) => void;
  getLog: () => readonly LogEntry[];
  reset: () => void;
  getPendingUpiRequest: () => PendingUpiRequest | null;
  respondInUpiApp: (paymentId: string, decision: "approve" | "decline") => void;
}

/**
 * Start the in-browser backend. Resolves once the service worker can answer requests.
 * The worker is the app's: it imports MSW's when its URL asks for mocking.
 */
export async function startBackend(worker: WorkerLocation): Promise<void> {
  // The backend only runs in the browser. Next replaces `typeof window` at build time,
  // so keeping the import inside this check also keeps the browser-only MSW build out
  // of the server bundle.
  if (typeof window !== "undefined") {
    const { startWorker } = await import("./runtime/worker");
    await startWorker(worker);
  }
}

export async function getSandboxControl(): Promise<SandboxControl> {
  const { getSandbox } = await import("./runtime/sandbox");
  const sandbox = getSandbox();
  return {
    subscribe: (listener) => sandbox.subscribe(listener),
    getVersion: () => sandbox.getVersion(),
    getPresetId: () => sandbox.getState().presetId,
    setPreset: (id) => {
      sandbox.setPreset(id);
    },
    getLog: () => sandbox.getState().log,
    reset: () => {
      sandbox.reset();
    },
    getPendingUpiRequest: () => sandbox.getPendingUpiRequest(),
    respondInUpiApp: (paymentId, decision) => {
      sandbox.respondInUpiApp(paymentId, decision);
    },
  };
}
