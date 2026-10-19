# 013 — UPI by intent link and QR code, settled by webhook

**Status:** Accepted

## Context

UPI is how most Indian buyers pay online, and an Indian checkout without it isn't one.
Two facts shaped how to add it:

- **Merchants can't "collect" any more.** In a collect payment, the merchant sends a
  request to a buyer's UPI ID. NPCI withdrew collect between people on 1 October 2025,
  and for payments to merchants on 28 February 2026. Merchants now use **intent** on a
  phone (a link that opens the buyer's UPI app) and a **QR code** on a computer.
- **The buyer approves in another app.** Approval happens between the buyer, their UPI
  app and their bank, never in this page. The shop hears the outcome from its payment
  provider, as it does for a card's 3-D Secure check ([004](004-payments-and-webhooks.md)).

## Decision

**On the server**

- **A UPI payment is a request.** `POST /api/orders/:orderId/payments` with
  `{ "method": "upi" }` answers `202` with a payment in `requires_action` and a
  `nextAction` of `{ type: "upi", intentUri, expiresAt }`. A body naming the buyer's UPI
  ID, as collect would need, is refused.
- **The intent is the standard `upi://pay` link** from NPCI's UPI linking
  specification. It carries:
  - the payee's address (`pa`) and name (`pn`);
  - the merchant category code (`mc=7922`, ticket agencies);
  - a reference unique to the payment (`tr`, the payment's id);
  - a note (`tn`);
  - the amount, always with two decimals (`am`);
  - the currency (`cu=INR`).

  The QR code encodes the same link. The payee is `admit-one@example`, a handle no bank
  issues, so scanning the demo's code with a real UPI app can't pay anyone.

- **The webhook decides.** Approving schedules `payment.succeeded`. Declining, by the
  buyer or by their bank, schedules `payment.failed` with `upi_declined`. Both go through
  the existing outbox, deduplicated by event id.
- **A request runs out.** After 5 minutes, it reads as failed with `upi_expired`. Like a
  hold, this is worked out when read and written down by the next command, never by a
  timer. A request never outlasts the hold it pays for, since approving it after the
  seats were released could only end in a refund.
- **A request can be cancelled.** `POST /api/payments/:paymentId/cancel` lets the buyer
  give up on a request to pay another way. Cancelling twice answers the same.
  Cancelling after approval is a `409`: the money may already be moving.

**In the checkout**

- **Payment methods are a registry,** like the steps ([003](003-step-registry.md)).
  Each method says when it's offered (UPI for rupees only). Adding net banking or a
  wallet means adding an entry and its view.
- **The page shows the request the way the buyer will use it:**
  - a QR code on a computer;
  - a button that opens the UPI app on a phone;
  - the time left;
  - a way to cancel.
- **The page re-reads the order every 2 seconds** while the request waits. Once the
  buyer approves, the payment is with the provider and the checkout hands over to the
  order page, which waits for the webhook as it does for cards.
- **Focus follows the outcome.** It moves to the request when it appears, and to the
  notice when a request ends without paying.
- **The QR code is drawn in React** from the `uqr` encoder (MIT, no dependencies, about
  4 KB gzipped). It's an SVG path rather than a markup string, so the content security
  policy needs nothing new. It's always black on white, because dark-on-light codes
  scan most reliably, so dark mode doesn't invert it.
- **The buyer's phone is simulated by the sandbox.** It sits below the checkout, never
  over it. It talks to the sandbox's port, not the shop's API, since that's where a real
  answer happens.

## Consequences

- Paying by UPI exercises the same guarantees as a card: idempotent requests, a
  deduplicated webhook, a page that waits for the truth, and a refund if the money
  lands after the hold.
- **One change isn't additive:** a payment's `last4` is now `null` for UPI.
  - A client that assumes a string breaks.
  - So do clients that parse `method`, `nextAction` or the new failure codes strictly,
    as this one does, unless they ship with the server.

  A public API would version this, or add the new fields only when the client asks.

- A real integration would also ask the provider for a payment's status when a webhook
  is late, rather than rely on webhooks alone.
- Left out, deliberately:
  - signed intents and QR codes (`mode`, `orgid`, `sign`), which a real provider
    generates;
  - UPI AutoPay mandates;
  - refunds back to UPI;
  - third-party validation of the payer's account.
