/**
 * Starts the service worker that answers `/api/*` requests. The API client waits for
 * this before its first request (see `instrumentation-client.ts`), so no request can
 * slip past to a real network before the simulated backend is ready.
 *
 * The worker is the app's (`public/sw.js`), which imports MSW's when its URL asks for
 * mocking; the app says where it is.
 */

import type { SetupWorker } from "msw/browser";

/** Where the app's service worker is, since the backend runs inside it. */
export interface WorkerLocation {
  url: string;
  options?: RegistrationOptions;
}

let started: Promise<void> | null = null;
let worker: SetupWorker | null = null;

const startOptions = (location: WorkerLocation) => ({
  serviceWorker: { url: location.url, ...(location.options && { options: location.options }) },
  // Anything that isn't /api/* (pages, scripts, fonts) goes to the network as usual.
  onUnhandledFrame: "bypass" as const,
  quiet: true,
});

export function startWorker(location: WorkerLocation): Promise<void> {
  started ??= (async () => {
    const [{ setupWorker }, { createHandlers }, { getSandbox }] = await Promise.all([
      import("msw/browser"),
      import("@/backend/http/handlers"),
      import("./sandbox"),
    ]);
    worker = setupWorker(
      ...createHandlers(getSandbox(), {
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: Math.random,
        now: Date.now,
      }),
    );
    await worker.start(startOptions(location));
  })();
  return started;
}

/**
 * Start the worker again: the browser stopped it (an idle worker, a tab in the
 * background), and the one that started afterwards doesn't know this page, so it lets
 * the API's requests through to the network. Starting again introduces the page anew.
 */
export async function restartWorker(location: WorkerLocation): Promise<void> {
  await startWorker(location);
  if (!worker) return;
  await worker.stop();
  await worker.start(startOptions(location));
}
