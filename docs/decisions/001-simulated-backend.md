# 001 — The backend runs in the browser

**Decision.** The API is served by [MSW](https://mswjs.io) in the visitor's browser,
backed by a plain-TypeScript server module (`src/server/`). The app talks to `/api/*`
with ordinary `fetch` and can't tell the difference.

**Why.**
- Anyone can run the demo with zero setup: no database, no keys, no accounts, no cost.
- Every visitor gets an isolated sandbox, so nobody's chaos affects anyone else.
- The chaos panel needs to control the server. Owning the server makes that honest
  rather than hacked in.

**Consequences.**
- MSW runs handlers in the page, so the server's memory is the page's memory. State is
  persisted to sessionStorage, including the webhook outbox, so a reload resumes.
- True multi-client concurrency isn't exercised. In a real database the
  availability check and the hold insert would be one transaction (or a conditional
  `UPDATE … WHERE available >= qty`). Here the server is single-threaded, so it's
  atomic by construction. Contention is simulated by a "crowd" of bot buyers.
- The server is written as a real one would be — validation, status codes,
  idempotency, a state machine — so swapping in a real backend means replacing
  `src/mocks/`, not the app.
