# 004 — The webhook is the source of truth

**Status:** Accepted

## Context

After paying, two signals race back: the browser's redirect and the provider's
webhook. Redirects get lost (a closed tab), arrive late, and can be replayed (a typed
URL). Webhooks are guaranteed — at least once, which means sometimes twice. Treating
the redirect as proof is how checkouts ship "paid but no tickets" and "tickets but not
paid".

## Decision

- Paying returns `202` with a payment in `processing`, never "paid". The browser goes to
  the order page, which polls (0.5 s, 1 s, 2 s, then every 4 s) until the webhook has
  settled the order, and says so reassuringly after 8 s.
- Webhooks are deduplicated by event id, recorded before acting, with a second guard
  that ignores events for orders that are already settled.
- Payments carry an `Idempotency-Key`, handled in the HTTP layer as Stripe describes:
  the response to an attempted charge is stored against the key and replayed for any
  repeat; a reused key with a different request is rejected. Requests rejected before
  charging aren't stored, so the same key can retry once they're fixed.
- The client mints one key per _attempt_: a retry after a network error reuses it; a
  definitive answer (declined, authentication failed) or a different card starts a new
  one.
- Orders need no key: one order per hold makes `POST /api/orders` a natural upsert.

## Consequences

- Duplicate, early and late webhooks are all routine, and each has a chaos preset and
  a browser test.
- A double-click or a retried request can never charge twice — and the backend also
  refuses a second payment while one is in flight, as a second line of defence.
- A declined card is an _outcome_ in the domain (a failed payment), not an error; the
  HTTP layer expresses it as a `402` problem.
