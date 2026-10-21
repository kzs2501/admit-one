/**
 * The simulated backend, for stories. Components that fetch their own data talk to the
 * same HTTP handlers as the app, through the same service worker, but each story gets
 * a fresh backend: nothing one story does is seen by the next.
 *
 * Ids and randomness are deterministic, and the clock is the page's own, so a test
 * that fixes the page's time (the screenshot tests do) fixes the backend's too.
 */
import { setupWorker } from "msw/browser";
import { createBackend, type Backend } from "@/backend/backend";
import type { PresetId } from "@/backend/chaos/presets";
import { createInitialState } from "@/backend/domain/state";
import { createHandlers } from "@/backend/http/handlers";
import { seededRandom } from "@/core/random";
import { setApiReadiness } from "@/lib/api-client";
import { signDemoTicket } from "@/core/demo-ticket-key";

/** What a story may ask of its backend, as `parameters.sandbox`. */
export interface SandboxParameters {
  preset?: PresetId;
}

const SEED = 20_261_018;

function createStoryBackend(presetId: PresetId): Backend {
  let idCount = 0;
  const random = seededRandom(SEED);
  return createBackend(
    {
      now: Date.now,
      newId: (prefix) => `${prefix}_${String(++idCount).padStart(4, "0")}`,
      newToken: () => `story-token-${++idCount}`,
      random,
      signTicket: signDemoTicket,
    },
    createInitialState(presetId, Date.now()),
  );
}

const handlersFor = (backend: Backend) =>
  createHandlers(backend, {
    // No simulated latency: a story shows a state, not a wait for one.
    sleep: () => Promise.resolve(),
    random: seededRandom(SEED),
    now: Date.now,
  });

const worker = setupWorker();
// Anything that isn't /api/* (modules, fonts) goes to the network as usual.
const started = worker.start({ onUnhandledFrame: "bypass", quiet: true });
// Every API request waits for the worker, as it does in the app.
setApiReadiness(started);

/** Everything the app keeps in sessionStorage is prefixed with this. */
const APP_STORAGE_PREFIX = "admit-one:";

function forgetAppStorage() {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(APP_STORAGE_PREFIX)) sessionStorage.removeItem(key);
  }
}

/** Give the story a fresh backend; returns the clean-up for when it's left. */
export async function startStorySandbox({ preset = "happy" }: SandboxParameters = {}) {
  await started;
  forgetAppStorage();
  const backend = createStoryBackend(preset);
  worker.resetHandlers(...handlersFor(backend));
  return () => {
    forgetAppStorage();
  };
}
