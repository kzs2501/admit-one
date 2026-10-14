# 001 — The backend runs in the browser

**Status:** Accepted (revised by [005](005-layers-and-enforced-boundaries.md): the backend is now reached only through HTTP or its public port)

## Context

The demo has to run for anyone, instantly, with nothing to sign up for and nothing to
pay for. It also needs a chaos panel that genuinely controls the server's behaviour —
duplicate webhooks, expiring holds, a crowd of other buyers — and every visitor's
chaos must stay their own.

## Decision

The API is served by [MSW](https://mswjs.io) in the visitor's browser, backed by a
plain-TypeScript backend (`src/backend/`). The app talks to `/api/*` with ordinary
`fetch` and can't tell the difference. The backend starts in
`src/instrumentation-client.ts`, before the app is interactive, and the API client
holds requests until its service worker answers.

The backend's state, including webhooks still in the outbox, is persisted to
sessionStorage under a versioned key and parsed against a schema on every restore. A
save from an older shape is simply ignored: it's a per-tab demo sandbox, so a fresh one
is the right answer, and a migration framework would be weight without value.

## Consequences

- Zero setup, an isolated sandbox per tab, and a chaos panel that controls the real
  code paths rather than faking their results.
- True multi-client concurrency isn't exercised. In a real database the availability
  check and the hold insert would be one transaction (or a conditional
  `UPDATE … WHERE available >= quantity`); here the backend is single-threaded, so it's
  atomic by construction. Contention is simulated by a crowd of bot buyers.
- Swapping in a real backend means deleting `src/backend/` and the line in
  `instrumentation-client.ts` that starts it. Lint enforces that nothing else depends
  on it.
