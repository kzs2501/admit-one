# 004 — The webhook is the source of truth

**Decision.** Paying returns `202 processing`, never "paid". The browser goes to the
order page, which polls until the provider's webhook has settled the order. Payments
carry an `Idempotency-Key`; webhooks are deduplicated by event id.

**Why.**
- The redirect after payment can be slow, lost, refreshed or replayed. The webhook is
  what the provider guarantees (at least once). Treating the redirect as proof is how
  checkouts ship "paid but no tickets" and "tickets but not paid" bugs.
- At-least-once delivery means duplicates are normal. Processing records the event id
  first, so a second delivery is a no-op. A second guard ignores webhooks for orders
  that are already settled.

**Idempotency, two ways.**
- *Orders* have a natural key — one order per hold — so `POST /api/orders` is an upsert
  and needs no header.
- *Payments* have no natural key, so the client sends one. It's minted per *attempt*:
  a retry after a network error reuses it (safe, never a second charge), and only a
  definitive answer — declined, authentication failed — starts a new attempt. A reused
  key with a different body is rejected, as Stripe does.

**Polling.** 0.5s, 1s, 2s, then every 4s. After 8s the page says it's taking longer
than usual and that nothing more is needed. It stops once the order is settled — or
when there's nothing in flight to wait for.
