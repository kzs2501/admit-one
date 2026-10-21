# 019 — Offline tickets and a door scanner

**Status:** Accepted

## Context

A ticket is used at a door, and doors are where networks fail: a basement venue, a
field, a crowd of phones on one cell. A ticket that has to be fetched from a server, or
checked against one, fails exactly there. So the buyer needs their ticket with no
network, and the door needs to tell a real ticket from a copy or a fake with no network
either.

## Decision

**A ticket is a signed token**

- **`ao1.<kid>.<payload>.<signature>`.** The payload is the ticket's claims (code,
  event, name, tier, seat) as base64url JSON, signed with Ed25519 (RFC 8032). It isn't a
  JWT: there's one algorithm and no header to trust, so there's no `alg` to confuse,
  and the key id lets keys rotate.
- **Signed when tickets are issued,** in the domain (`deps.signTicket`), so both
  backends issue the same thing. The contract's ticket gains `token`, additively
  ([007](007-typed-contract-and-iso-times.md)).
- **`@noble/ed25519`, not Web Crypto.** Ed25519 is in Web Crypto in every engine now,
  but its signing is async and the domain is synchronous. Making the domain async for
  one call was the wrong trade; noble is small, audited and synchronous.
- **Keys follow who signs.** The sandbox signs with a committed demo key, labelled as
  one: anyone who reads its bundle can sign tickets its scanner trusts. That's the
  honest limit of a backend in the browser. A server signs with `TICKET_SIGNING_KEY`
  and refuses to start in production without it.

**The wallet**

- **On the device.** The order page saves its tickets to IndexedDB once they're issued,
  and `/tickets` lists them from there alone, so it opens in airplane mode.

**One service worker for the app and the sandbox's API**

- **One worker, two jobs.** A scope has one worker, and MSW's already had the site's.
  `public/sw.js` is the app's worker; it imports MSW's when its URL asks for mocking
  (MSW, "Merging service workers"). The URL says what it does: `/sw.js?mocking=1&offline=1`
  in the sandbox, `/sw.js?offline=1` in server mode. Development caches nothing.
- **Its listeners first.** MSW answers every request from a page it controls, so the
  app's listeners are added before it is imported, and stop the event for the requests
  they own: navigations, the build's hashed assets, and the files in `/vendor/`.
- **What it caches, and how:**
  - the offline pages (`/tickets`, `/scan`): network first, so a deploy shows at once;
    the cached copy with no network, or after 3 s on a slow one;
  - files named by their content or version: cache first, kept only for the offline
    pages, at most 200, oldest out first;
  - any other page, offline: a short page that says so and links to the wallet and the
    scanner.
- **Not RSC payloads.** A payload depends on the router's state header, so one cached
  by URL could be wrong for the next navigation. Offline, Next falls back to a full
  navigation, and the worker answers that.
- **Precaching waits for the page.** MSW's start waits for the worker, so precaching
  during install would delay the sandbox's first API call. The page asks once it has
  loaded instead.
- **The files a first visit loaded.** On a first visit the page loads its files before
  the new worker controls it, so the worker never sees them. The page tells it which of
  the build's files it loaded (from resource timing), and the worker keeps them if the
  page works offline: Workbox's "cache the URLs the page already loaded".
- **It outlives its tabs.** MSW's worker unregisters itself when its last tab closes,
  which would leave the wallet with no worker the next time it opens offline. The
  merged worker keeps its registration. That's safe: MSW answers nothing until a page
  turns mocking on again.
- **Never stale.** `sw.js` and `mockServiceWorker.js` are served `no-cache` and
  registered with `updateViaCache: "none"`; caches are versioned, and activating
  deletes every other version.

**The door scanner**

- **`/scan`,** for door staff (not indexed; linked from the footer). Pick the event,
  start the camera (on request, never on load, so the permission prompt has a reason),
  hold up a ticket.
- **A pure decision.** `checkTicket` says not a ticket, a key it doesn't trust, forged,
  another event's, or valid; then `doorOutcome` asks the device's scan log. The first
  scan admits; every later one says when that was.
- **One transaction per scan.** The scan log reads and writes in one IndexedDB
  transaction, so two tabs can't both let one ticket in.
- **Fails closed.** The scanner trusts the keys its backend signs with. A production
  server's scanner never trusts the demo key, and with no key it says it can't check
  tickets.
- **The browser's detector, or ZXing in WebAssembly.** `BarcodeDetector` exists only in
  Chromium on Android and macOS. Elsewhere the `barcode-detector` ponyfill gives the
  same API with ZXing-C++ compiled to wasm: loaded only by `/scan`, served from this
  site (copied from `node_modules` after install, named by version, cached for good),
  and fetched as soon as the scanner opens, so one visit online leaves it ready offline.
- **A photo instead,** for no camera, a refused one, or a keyboard.
- **Readable at arm's length.** Results are in words and colour (WCAG 1.4.1), in a live
  region (4.1.3), a new node each time so a repeated result is announced again, with a
  buzz where the device has one.
- **Least privilege.** `/scan` alone gets `camera=(self)` and `'wasm-unsafe-eval'`. Every
  other page keeps the camera off and compiles no wasm ([009](009-security-headers.md)).

## Consequences

**Proven by tests:**

- **The wallet offline:** after a reload and in a new tab, on both backends. Chromium's
  offline mode covers the worker's own requests, so the page came from its cache.
- **The door by photo:** a bought ticket gets in once; a forged ticket, another event's
  and a stranger code are refused; it works offline after one visit online.
- **The door by camera:** Chromium's fake camera plays a feed with a signed ticket in
  it, and the scanner reads it, then reads it as already scanned after a reload. This
  needs full Chromium: the headless shell Playwright runs by default has no camera.
- **The permissions:** another page asking for the camera is refused, and only `/scan`
  has its headers. The buyer's pages never load the reader.

**Mutants caught:** MSW's listener first; no unregister guard; no precache; no
scan log; any signature; a read-then-write scan log; the page's list of loaded files
ignored; `/scan` not offline; the scanner's policy on every page.

**Kept without a test:** `stopImmediatePropagation`. In Chromium, MSW's listener does
nothing on a request already answered, so a version without it passes every test. It
stays because the DOM still runs later listeners, and MSW's could change.

**Limits:**

- **Two doors offline** each let a copied ticket in once: one device's log can't see
  another's. Posting scans to the server when online, first scan wins, is the next step.
- **A screenshot is as good as the ticket.** The token is a bearer credential. Codes
  that rotate every few seconds need a secret on the buyer's device, which is out of
  scope here.
- **The native detector,** and the scanner on a real phone, are checked by hand.
