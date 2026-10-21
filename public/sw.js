/**
 * admit-one's one service worker. A scope has one worker, and the sandbox's API already
 * runs in one (MSW's), so this worker does both jobs, as MSW's docs suggest ("Merging
 * service workers"). What it does is in its URL, so each build registers one URL:
 *
 * - `offline=1` keeps the tickets wallet working with no network. Its page is
 *   network-first and cached; the build's hashed assets are served cache-first; any
 *   other page, offline, gets a short page that points to the wallet.
 * - `mocking=1` then imports MSW's worker, which answers `/api/*` for the sandbox.
 *
 * The order of listeners matters. MSW answers every request from a page it controls,
 * so this worker's listeners are added first, and they stop the event before MSW's on
 * the requests they own. See ADR 019.
 */
const params = new URL(self.location.href).searchParams;
const OFFLINE = params.get("offline") === "1";
const MOCKING = params.get("mocking") === "1";

// Bump when what's cached, or how, changes: activating deletes every other version.
const VERSION = "v1";
const PAGES = `admit-one-pages-${VERSION}`;
const ASSETS = `admit-one-assets-${VERSION}`;
/** Pages that work with no network. */
const OFFLINE_PAGES = ["/tickets"];
/** Hashed assets are kept up to this many, oldest first out, so old builds don't pile up. */
const MAX_ASSETS = 200;
/** On a slow network, a cached offline page is shown after this long. */
const NETWORK_TIMEOUT_MS = 3000;
/** The message a page sends, once it has loaded, to have the offline pages cached. */
const PREPARE_OFFLINE = "admit-one:prepare-offline";

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = [PAGES, ASSETS];
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("admit-one-") && !current.includes(name))
          .map((name) => caches.delete(name)),
      );
      // Start fetching a page while the worker starts up, rather than after. Only this
      // worker's own page handlers use the early response.
      const preload = self.registration.navigationPreload;
      if (preload) await (OFFLINE ? preload.enable() : preload.disable());
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== PREPARE_OFFLINE) return;
  event.stopImmediatePropagation();
  if (OFFLINE) event.waitUntil(prepareOffline());
});

self.addEventListener("fetch", (event) => {
  if (!OFFLINE) return;
  const { request } = event;
  const url = new URL(request.url);
  // DevTools' "only-if-cached" requests can't be fetched from here; leave them alone.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  if (request.mode === "navigate") {
    event.stopImmediatePropagation();
    event.respondWith(OFFLINE_PAGES.includes(url.pathname) ? offlinePage(event, url.pathname) : anyPage(event));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.stopImmediatePropagation();
    event.respondWith(asset(event));
  }
});

// After this worker's listeners, so they run first.
if (MOCKING) self.importScripts("/mockServiceWorker.js");

// MSW's worker unregisters itself when its last tab closes. This one has to outlive its
// tabs, or the wallet would find no worker the next time it opens offline. Staying
// registered is safe: MSW answers nothing until a page turns mocking on again.
if (MOCKING && OFFLINE) {
  Object.defineProperty(self.registration, "unregister", { value: () => Promise.resolve(false) });
}

/** Network first, so a deploy shows at once; the cached copy when there's no network. */
async function offlinePage(event, path) {
  const cache = await caches.open(PAGES);
  const network = (async () => {
    const response = (await event.preloadResponse) ?? (await fetch(event.request));
    if (response.ok && response.type === "basic") await cache.put(path, response.clone());
    return response;
  })();
  event.waitUntil(network.catch(() => undefined));
  const cached = await cache.match(path, { ignoreVary: true });
  if (!cached) return network.catch(() => offlineFallback());
  return Promise.race([network, delay(NETWORK_TIMEOUT_MS).then(() => cached)]).catch(() => cached);
}

/** Every other page needs the network; with none, a page that says so. */
async function anyPage(event) {
  try {
    return (await event.preloadResponse) ?? (await fetch(event.request));
  } catch {
    return offlineFallback();
  }
}

/** Hashed, so never stale: the cached copy when there is one. Kept for offline pages. */
async function asset(event) {
  const cache = await caches.open(ASSETS);
  // A hashed URL names one file, whatever the request's headers.
  const cached = await cache.match(event.request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok && (await fromOfflinePage(event))) {
    event.waitUntil(cache.put(event.request, response.clone()).then(() => trim(cache)));
  }
  return response;
}

async function fromOfflinePage(event) {
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  return client ? OFFLINE_PAGES.includes(new URL(client.url).pathname) : false;
}

let prepared = null;

/** Cache the offline pages and every asset their HTML names, once per worker start. */
function prepareOffline() {
  prepared ??= (async () => {
    const [pages, assets] = await Promise.all([caches.open(PAGES), caches.open(ASSETS)]);
    for (const path of OFFLINE_PAGES) {
      const response = await fetch(path, { priority: "low" });
      if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);
      const html = await response.clone().text();
      // Putting an asset again moves it to the back of the queue `trim` empties.
      for (const href of assetsNamedIn(html)) {
        const asset = await fetch(href, { priority: "low" });
        if (asset.ok) await assets.put(href, asset);
      }
      await pages.put(path, response);
    }
    await trim(assets);
  })().catch((error) => {
    prepared = null;
    console.warn("[sw] Couldn't prepare the offline pages", error);
  });
  return prepared;
}

/** The build's assets a page's HTML names: its scripts, styles, fonts, and the chunks its
 * inline React payload refers to (as JSON inside a script, so with escaped quotes). */
function assetsNamedIn(html) {
  const hrefs = html.match(/\/_next\/static\/[^"'\s\\)]+/g) ?? [];
  return [...new Set(hrefs)];
}

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function offlineFallback() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>You’re offline · admit-one</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; padding: 1rem; text-align: center; }
  a { font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>You’re offline</h1>
<p>This page needs a connection. Your tickets are saved on this device.</p>
<p><a href="/tickets">Open your tickets</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
