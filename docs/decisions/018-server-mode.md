# 018 — Server mode: the same API on Postgres, with a simulated provider's signed webhooks

**Status:** Accepted. Amended 2026-10-23, after a review: secrets at start-up, delivery
with retries, payments judged when they happened, one lock order, and limits on input.

## Context

Dress Circle's backend runs in the browser ([001](001-simulated-backend.md)), which makes
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
- **An idempotency claim is owned.** The claim carries a token (when it was made), and
  completing or releasing it matches the key and the token. A process whose claim went
  stale and was taken by another can't then overwrite the other's answer.
- **One hold at a time per event, and one lock order.** A hold first takes its event's
  lock (`pg_advisory_xact_lock`), so the single-seat-gap check and best available see
  every seat claimed before them. Then it locks the expired holds it sweeps, then all
  of the event's tiers in id order, the order a payment's conversion takes them too, so
  the two can't deadlock. A deadlock or serialisation failure that happens anyway
  is tried again, up to three times; after that the answer is `503
service_unavailable` with `Retry-After`. Any other database error is a `500
internal_error` problem, never a bare 500.
- **Statuses the code knows.** Status columns are text, held to their values by CHECK
  constraints built from the code's own constants.
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
  `after`, on the payment, 3-D Secure and cancel routes), and at the latest when the
  buyer next reads the order. Delivery is at least once: an event is marked sent only
  when the endpoint accepts it.
- **One delivery at a time, and a failure is retried.** A sender takes due events with
  `FOR UPDATE SKIP LOCKED` and a 30-second lease, so two senders never deliver one event
  together. Each delivery is sent on its own: one that fails records its error and is
  tried again later, doubling from a second up to a minute, ten times at most. A failed
  delivery never fails the buyer's read that triggered it. Before this, one event that
  threw broke every order page.
- **A backstop that doesn't wait for a reader:** `GET /api/internal/deliver`, with
  `Authorization: Bearer $CRON_SECRET`, compared in constant time. Without the secret
  the route doesn't exist (404). Something has to call it every minute or so: Vercel's
  Hobby crons run daily at most, so it's a Pro cron or a scheduled GitHub Action.
- **Judged when it happened.** A payment confirmed before its hold ran out keeps its
  tickets, however late the webhook arrives: the event carries the provider's own time,
  and the hold's life is judged at that moment. The exception is a hold already swept,
  whose stock may have been sold since; that payment is refunded. Converting a hold is
  `UPDATE … WHERE status = 'active'`, so a swept hold can't be converted, or its stock
  released twice.
- **Retried by the provider.** An event for a payment the server doesn't know answers
  404 and isn't recorded, so the provider tries again. Signatures may carry several
  `v1=` values, so the secret can be rotated.
- **Through the real endpoint,** in-process: every webhook goes through the same
  verification a real provider's would.

**Postgres for development and tests**

**What the server refuses**

- **To start without its secrets.** In production, `DATABASE_URL`, `WEBHOOK_SECRET`,
  `TICKET_SIGNING_KEY` and `FINGERPRINT_SECRET` are required; the development fallbacks
  apply only when `NODE_ENV` is `development` or `test`. A `CI` variable used to switch
  them on too, which hid production-only failures in CI. A start that fails isn't
  cached, so the next request tries again.
- **What the contract shouldn't accept.** A tier twice in one hold (the sandbox used to
  oversell it); names over 100 characters, emails over 254, bodies over 64 KB (`413
payload_too_large`); an id like `constructor` (a 404, not a 500); and UPI, which waits
  for a real provider (`422 payment_method_unavailable`).
- **Card details in the idempotency fingerprint.** The fingerprint that tells a retry
  from a reused key is an HMAC of the body under `FINGERPRINT_SECRET`, with the CVC left
  out. PCI DSS allows a keyed hash of a card number, never a stored CVC. The sandbox
  hashes without a key: its "card numbers" are test numbers in the visitor's own tab.

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
- removing the dedupe or the signature tolerance;
- one delivery's failure not caught, so it stops the rest;
- a payment judged at delivery rather than when it happened;
- converting a hold without `status = 'active'`;
- a claim completed without its token;
- a tier allowed twice in one hold;
- the CVC in the fingerprint.

**Argued, not tested:** the lock order. Deadlocks between mixed-tier holds and the sweep
didn't reproduce in tests, so the retries are tested directly, and the order is in the
code's comments.

**One contract, two backends.** The same 14 HTTP contract tests pass on the sandbox and
on the server, and 24 end-to-end flows, tagged `@both`, pass against a server-mode
build.

**Still not done:**

- **The constant-time compare** can't be caught by a functional test; review guards it.
- **The rate limit is per IP** (amended 2026-10-24). Reserving is limited as in the
  sandbox, 20 a minute, refusals counted, but per client, in a Postgres table every
  instance shares, under a lock on the client's key. The key is the IP from a header a
  trusted proxy sets. Without one the server can't tell clients apart and doesn't
  limit, since one shared bucket would let a single client block everyone. A burst of
  30 at once lets exactly the limit through, and the same attempts get the sandbox's
  answers.
- **Organisers still sign in with a bearer token,** in the sandbox only. Cookie sessions
  come if the dashboard moves to the server.
- **UPI on the server** waited for a real provider. Done in [020](020-razorpay-test-mode.md):
  Razorpay's Checkout, whose webhooks carry no timestamp, so dedupe by event id is the
  replay defence (and Checkout offers whatever the Razorpay account has on).
