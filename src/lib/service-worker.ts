/**
 * The app's one service worker (`public/sw.js`). It keeps the tickets wallet working
 * with no network, and in the sandbox it runs MSW's worker too, because a scope can
 * have only one. What it does is in its URL, so each build registers a single URL:
 * the sandbox's MSW starts the worker at this URL; in server mode the app registers it.
 * See ADR 019.
 */
import { isServerMode } from "./backend-mode";

/** In development, nothing is cached: a cached script would hide the change just saved. */
const isCaching = process.env.NODE_ENV === "production";

function workerUrl() {
  const params = new URLSearchParams();
  if (!isServerMode) params.set("mocking", "1");
  if (isCaching) params.set("offline", "1");
  const query = params.toString();
  return query ? `/sw.js?${query}` : "/sw.js";
}

export const SERVICE_WORKER_URL = workerUrl();

/** Check for a new worker on every load, past the HTTP cache: a stale one serves stale pages. */
export const SERVICE_WORKER_OPTIONS = { updateViaCache: "none" } satisfies RegistrationOptions;

/** The message `sw.js` waits for, to cache the offline pages. */
const PREPARE_OFFLINE = "admit-one:prepare-offline";

/**
 * Once the page has loaded, so it never competes with the page: register the worker if
 * nothing else has, then have it cache what the wallet needs to open offline.
 */
export function prepareOffline() {
  if (!isCaching || !("serviceWorker" in navigator)) return;
  const run = () => {
    (async () => {
      if (isServerMode) await navigator.serviceWorker.register(SERVICE_WORKER_URL, SERVICE_WORKER_OPTIONS);
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: PREPARE_OFFLINE });
    })().catch((error: unknown) => {
      // The app works without it; only the wallet won't open offline.
      console.warn("[service-worker] Couldn't prepare for offline", error);
    });
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}
