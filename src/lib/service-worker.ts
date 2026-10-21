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

/** The message `sw.js` waits for, to cache what the offline pages need. */
const PREPARE_OFFLINE = "admit-one:prepare-offline";

/**
 * The build's files this page has loaded. On a first visit the page loads them before
 * the new worker controls it, so the worker never saw them; it's told instead, and
 * keeps them if this is a page that works offline (Workbox's "cache the URLs the page
 * already loaded").
 */
function loadedAssets() {
  return performance
    .getEntriesByType("resource")
    .map((entry) => new URL(entry.name))
    .filter(
      (url) =>
        url.origin === location.origin &&
        (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/")),
    )
    .map((url) => url.href);
}

async function tellWorker() {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: PREPARE_OFFLINE, urls: loadedAssets() });
}

const warn = (error: unknown) => {
  // The app works without it; only the offline pages won't open offline.
  console.warn("[service-worker] Couldn't prepare for offline", error);
};

/**
 * Once the page has loaded, so it never competes with the page: register the worker if
 * nothing else has, then have it cache what the offline pages need.
 */
export function prepareOffline() {
  if (!isCaching || !("serviceWorker" in navigator)) return;
  const run = () => {
    (async () => {
      if (isServerMode) await navigator.serviceWorker.register(SERVICE_WORKER_URL, SERVICE_WORKER_OPTIONS);
      await tellWorker();
    })().catch(warn);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

/** After a page has loaded more of the build (the scanner's reader, say), keep that for offline too. */
export function keepForOffline() {
  if (!isCaching || !("serviceWorker" in navigator)) return;
  tellWorker().catch(warn);
}
