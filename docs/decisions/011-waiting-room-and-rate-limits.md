# 011 — A waiting room for high-demand sales, and rate-limited reservations

**Status:** Accepted

## Context

A popular on-sale is the other half of the ticketing problem. When 40,000 people
arrive at once, letting them all reserve together means most of them fail at random,
retry, and make it worse. A script hammering the reservation endpoint does the same on
its own. The checkout needs two things:

- a fair, honest line, so the server isn't the one deciding by accident;
- a limit on how fast any one client can try.

## Decision

**Waiting room**

- **First in, first out, a batch at a time.** It's switched on by the "Flash sale"
  scenario: 40,000 ahead, 8,000 let in every 2 seconds. This is how Cloudflare's Waiting
  Room and Queue-it run their lines.
- **A place is computed, not ticked.** Status, people ahead and the wait are pure
  functions of when the place was taken and the clock, like a hold's expiry (ADR 002).
  Nothing runs on a timer, a reload resumes exactly, and reads never write. Each place
  copies the line's pace, so changing the scenario can't move it.
- **One visitor, one place.** Joining again while your place is live returns it, so a
  refresh or a double click never sends you to the back.
- **The server sets the pace.** Each status says when to check again (1–10 s), and the
  client polls exactly that often, and not at all in a hidden tab.
- **A turn lasts 10 minutes.** Reserving needs a `Queue-Token` header naming a place in
  this sale's queue whose turn has come and not gone. Otherwise the answer is
  `403 queue_required`. The header is transport, like `Idempotency-Key`; the rule
  about who may buy lives in the domain.
- **The page is honest and calm.**
  - It shows the people ahead, a `<progress>` that only moves forward, and the wait said
    coarsely ("less than a minute").
  - It speaks at milestones only.
  - When your turn comes, it's announced, focus moves to it, and the tab title changes.
    Nothing redirects you: you may be in another tab (WCAG 3.2.5).

**Rate limiting**

- **A sliding-window log in the HTTP adapter.** It's exact, with none of a fixed
  window's bursts at its edges. Reservation attempts are limited to 20 a minute, or 3
  every 15 seconds in "Too many attempts".
- **Refusals count.** A client that hammers keeps itself waiting; one that waits as
  long as it's told gets straight in.
- **A refusal is `429 rate_limited`** with `Retry-After` in seconds and
  `Cache-Control: no-store` (RFC 6585 §4, RFC 9110 §10.2.3). The problem repeats the wait
  as `retryAfterSeconds` for clients that read bodies.
- **The client obeys the server.** It parses `Retry-After` (delay-seconds or a strict
  HTTP-date) and treats a 429 as "not now", not "no": queries retry after exactly that
  long. Reserve stays off while a notice counts down, saying the wait once in words for
  screen readers.

## Consequences

- The line is fair and explainable: your place only improves, and the server, not
  luck, decides who's next.
- The people ahead are simulated. In a per-tab sandbox, you're the only real buyer, and
  the page says so.
- The limiter lives in the adapter's memory, per tab; a full reload starts it fresh. A
  real service keeps the log in shared storage (Redis, say), keyed by account or IP.
  RFC 6585 leaves "who is the client" to the server.
- Left out, deliberately:
  - signed, stateless queue tokens verified at the edge (HMAC or JWT), so the origin
    never sees an unadmitted request;
  - a randomised pre-queue for visitors who arrive before the sale opens;
  - the IETF `RateLimit` header fields, still a draft.
