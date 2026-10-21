# 018 — Server mode: the same API on Postgres, with a simulated provider's signed webhooks

**Status:** Accepted

## Context

admit-one's backend runs in the browser ([001](001-simulated-backend.md)), which makes
the demo free to run and lets the chaos panel control the server. But it can't show
what a real backend has to get right: many buyers at once, retries across processes,
and webhooks a stranger could forge. `architecture.md` described what a production
version would change; this decision makes the important parts real, without giving up
the in-browser demo.

## Decision

**Two backends behind one port**

- **A build-time switch.** `NEXT_PUBLIC_BACKEND=server` builds the app against a
  server; the default build is the sandbox, as before, and remains the public demo.
- **One HTTP adapter for both.** A catch-all Next route handler answers `/api/*` with
  the very handlers the sandbox runs in its service worker. MSW's `getResponse` is the
  router there: one function, behind `handle()`, replaceable by any router that takes a
  `Request` and gives a `Response`.
- **An async port.** The handlers await a port whose methods may answer with a
  promise. Its signatures are the sandbox's own, so they can't drift. The buyer's API
  runs on both backends; the waiting room and the organisers' dashboard stay the
  sandbox's (`501 not_in_server_mode`), as do the chaos presets.
- **The sandbox's rules, run on the server's rows.** For anything about an order, the
  server locks the hold's row, loads its rows into the sandbox's record shapes, runs the
  sandbox's own functions on them, and writes back what changed in the same
  transaction. The rules exist once; only storage differs. Everything about an order
  happens to its hold, so that one lock serialises a payment, another attempt and the
  webhook, across processes.

**What the database guarantees**

- **No oversold tickets.** A hold takes stock with one conditional update of the tier's
  own row: `UPDATE inventory SET held = held + n WHERE capacity - sold - held >= n`.
  Under READ COMMITTED a second buyer's update waits for the row lock, then checks its
  WHERE clause again against the committed row. The counter has to live on that row,
  because a subquery in the WHERE clause isn't run again on that re-check. A check
  constraint keeps `sold + held` within capacity as a backstop.
- **No seat held twice.** Each taken seat is a row in `seat_claims`, and a partial unique
  index allows one unreleased claim per seat. A sale updates the claim in place, so a
  seat is never free between "held" and "sold".
- **Lazy expiry, still.** Reads leave expired holds out at once; the next hold for the
  event releases their stock and seats in its own transaction ([002](002-holds-and-lazy-expiry.md)).
- **Idempotency across processes.** Keys live in a table, claimed with
  `INSERT … ON CONFLICT DO NOTHING` before the work starts. A repeat while the first is
  in flight gets `409 idempotency_key_in_use` (the IETF Idempotency-Key draft); a key
  left in flight by a process that died can be claimed again after a minute, and the
  order's own state still refuses a second charge.
- **Times from the app's clock,** never the database's `now()`, so tests on a fake clock
  behave alike on both backends.

**The simulated provider's webhooks**

- **Signed like a real provider's.** Events are queued when a payment starts and sent
  once due, signed `t=<unix>,v1=<HMAC-SHA256 of "t.body">` (Stripe's scheme).
- **Checked before anything is parsed:** over the raw body, with a constant-time compare
  and a five-minute tolerance. Forged, altered, replayed and unsigned webhooks get
  `400 invalid_signature`.
- **Acted on once.** The event id is inserted with `ON CONFLICT DO NOTHING` in the same
  transaction as its effect, so a duplicate does nothing and a crash can't leave an
  event recorded but not acted on.
- **Delivered without a timer.** After a payment's response is sent (`next/server`'s
  `after`), and at the latest when the buyer next reads the order. Delivery is at least
  once: an event is marked sent only when the endpoint accepts it.
- **Through the real endpoint,** in-process: every webhook goes through the same
  verification a real provider's would.

**Postgres for development and tests**

- **No Docker, no Homebrew.** The `embedded-postgres` package installs real
  PostgreSQL 17 binaries through npm. `npm run db:up` runs a throwaway cluster on its
  own port, and the server tests start a temporary one if no database answers. CI does
  the same, so there's no service container.
- **A database per test file,** copied from a migrated, seeded template.
- **Warm pools for race tests.** Opening a connection takes longer than a short
  transaction, so on a cold pool the first of several "simultaneous" requests finished
  before the rest had connected, and the race tests passed without the race. Each
  test database opens its whole pool first.

## Consequences

**Proven by tests, against real Postgres:**

- 50 buyers at the last 10 tickets get exactly 10 holds, and 20 buyers for a pair of
  seats get one. Ten runs in a row are green.
- Ten simultaneous payments for one order give one charge.
- Five deliveries of one webhook fulfil the order once.

**Mutants are caught:**

- removing the WHERE guard;
- a read-then-write stock update, which is correct sequentially and wrong
  concurrently;
- removing the row lock;
- removing the seat claims;
- removing the dedupe or the signature tolerance.

**One contract, two backends.** The same ten HTTP contract tests pass on the sandbox
and on the server, and 18 end-to-end buyer flows, tagged `@both`, pass against a
server-mode build.

**Still not done:**

- **The constant-time compare** can't be caught by a functional test; review guards it.
- **The server's rate limit is off:** one in-process limiter would count every client
  together. A real deployment limits per client, at the edge.
- **Organisers still sign in with a bearer token,** in the sandbox only. Cookie sessions
  come if the dashboard moves to the server.
- **UPI on the server** waits for a real provider. That's 6b: Razorpay test mode, whose
  webhooks carry no timestamp, so dedupe by event id is the replay defence.
