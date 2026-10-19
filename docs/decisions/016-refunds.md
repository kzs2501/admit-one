# 016 — Refunds: an idempotent request, settled by webhook, shown optimistically

**Status:** Accepted

## Context

Refunding is the organiser's most consequential action: money goes back and tickets
stop working. It has the same hazards as paying:

- a retried request mustn't refund twice;
- the provider's answer arrives later, by webhook.

It also needs a dashboard that feels immediate without ever showing a refund that
didn't happen.

## Decision

- **A refund is a request, settled by the provider.**
  `POST /api/organiser/orders/:id/refunds` with a reason answers `202` with the refund
  `pending`. The provider's `refund.succeeded` webhook settles it, through the same
  deduplicated outbox as payments ([004](004-payments-and-webhooks.md)).
- **Settlement voids the tickets and puts them back on sale.** The order goes
  `fulfilled → refunded` and its tickets stop working.
  - For a sandbox order, its sales come off.
  - For an order from the generated history, the tickets or seats are recorded as
    returned, so availability and the metrics agree.
- **Only whole orders, and only fulfilled ones.** A second refund, or a refund of an
  order that isn't fulfilled, is a 409.
- **Idempotent, like payments.**
  - An `Idempotency-Key` is required, and the rules live once in the HTTP kit, shared
    with payments.
  - An organiser's keys are scoped to their account.
  - A request turned away before anything happened isn't stored, so its key works once
    it's fixed.
- **The dashboard is optimistic, and honest about it** (TanStack Query, "Optimistic
  updates"):
  - the order, and its row on every cached table page, say "Refund pending" at once;
  - if the request fails, each goes back to what it was, and an alert with focus says
    why;
  - either way, the order is re-read for the server's word.
- **Each attempt has its own key.** A lost connection keeps it, so trying again can't
  refund twice; an answer from the server ends it.
- **Confirmation is a native `<dialog>`,** giving the amount, the buyer, what happens
  to their tickets, and a reason. When the button that opened it disappears (the refund
  is pending), focus moves to the message that replaced it.
- **The Refunds fail scenario** has the provider refuse with `502 refund_failed`, so
  the rollback can be seen and tested.

## Consequences

- A refund can't happen twice, can't be shown before it's real, and can't leave
  tickets both refunded and valid.
- **GST:** refunding a taxed sale needs a credit note (CGST Act §34). The sandbox
  issues no invoices, so it issues no credit notes, and says so.
- **Out of scope:**
  - partial refunds (a ticket, or the fees only);
  - refunds the provider accepts and later fails (`refund.failed`);
  - cancelling a whole event and refunding everyone.
