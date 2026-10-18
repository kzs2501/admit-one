/**
 * Starts the service worker that answers `/api/*` requests. The API client waits for
 * this before its first request (see `instrumentation-client.ts`), so no request can
 * slip past to a real network before the simulated backend is ready.
 */
let started: Promise<void> | null = null;

export function startWorker(): Promise<void> {
  started ??= (async () => {
    const [{ setupWorker }, { createHandlers }, { getSandbox }] = await Promise.all([
      import("msw/browser"),
      import("@/backend/http/handlers"),
      import("./sandbox"),
    ]);
    const worker = setupWorker(
      ...createHandlers(getSandbox(), {
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: Math.random,
        now: Date.now,
      }),
    );
    // Anything that isn't /api/* (pages, scripts, fonts) goes to the network as usual.
    await worker.start({ onUnhandledFrame: "bypass", quiet: true });
  })();
  return started;
}
