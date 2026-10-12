/**
 * Starts the service worker that answers `/api/*` requests. Every API call awaits
 * this first, so no request can slip past to a real network before the simulated
 * backend is ready.
 */
let ready: Promise<void> | null = null;

export function startMocks(): Promise<void> {
  ready ??= (async () => {
    const [{ setupWorker }, { createHandlers }, { getServer }] = await Promise.all([
      import("msw/browser"),
      import("./handlers"),
      import("./sandbox"),
    ]);
    const worker = setupWorker(
      ...createHandlers(getServer(), {
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        random: Math.random,
      }),
    );
    // Anything that isn't /api/* (pages, scripts, fonts) goes to the network as usual.
    await worker.start({ onUnhandledFrame: "bypass", quiet: true });
  })();
  return ready;
}
