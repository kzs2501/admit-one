# 002 — Holds expire lazily

**Decision.** Selecting tickets creates a hold with an `expiresAt`. Availability is
computed as `capacity − sold − tickets in live holds`, where _live_ means
`now < expiresAt`. Nothing runs on a timer to release expired holds.

**Why.**

- A sweeper job leaves a window where a dead hold still blocks a buyer, and it can fail
  or lag. Computing from `expiresAt` is correct at every instant.
- Reads never write. An unpaid order whose hold ran out _reads_ as `expired`; the
  status is persisted only when a write path runs into it.

**The edge case that matters.** A payment can still be in flight when the clock runs
out. Starting a payment extends the hold once (two minutes), and while a payment is
in flight the order isn't treated as expired — the webhook decides. If the payment
succeeds after the hold has expired anyway, the order is refunded in full and the UI
says why. The alternative — re-allocating tickets if any are still free — was
rejected for v0.1. It would hide the case this project exists to demonstrate, and
it can surprise a buyer with different seats or tiers.
