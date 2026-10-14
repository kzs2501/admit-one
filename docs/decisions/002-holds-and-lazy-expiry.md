# 002 — Holds expire lazily

**Status:** Accepted

## Context

Choosing tickets reserves them for a few minutes. Reservations have to stop counting
the moment they expire: a dead hold that still blocks the next buyer is a lost sale,
and on a nearly sold-out event it's the difference between "two left" and "sold out".

## Decision

A hold is a record with an `expiresAtMs`. Availability is computed at read time as
`capacity − baseline sold − sold − tickets in live holds`, where _live_ means
`now < expiresAtMs`. Nothing runs on a timer to release holds. An unpaid order whose
hold has run out _reads_ as `expired`; the status is only persisted when a write path
runs into it (`settleExpiry`).

## Consequences

- Correct at every instant, with no sweeper to fail or lag, and reads never write.
- A payment can still be in flight when the clock runs out. Starting a payment extends
  the hold once (by two minutes), and while a payment is in flight the order isn't
  treated as expired — the webhook decides.
- If the money still arrives after the hold is gone, the order is refunded in full and
  the UI says why. Re-allocating tickets if any happen to be free was rejected: it
  hides the case this project exists to demonstrate, and could surprise a buyer with
  a different tier.
