# 020 — Razorpay's test mode: hosted Checkout, settled by webhook or by asking

**Status:** Accepted.

## Context

Server mode ([018](018-server-mode.md)) ran the real API on Postgres with a simulated
payment provider. That left two gaps a real provider closes: UPI was refused on the
server, since nothing could reach the buyer's UPI app, and 3-D Secure was a dialog that
anyone holding the payment's id could approve. Razorpay is the provider an Indian
ticketing site would use (Stripe takes Indian merchants by invitation only), and its
test mode moves no money.

## Decision

**Hosted Checkout, not our card form**

- **Card details never reach this server.** Sending card numbers to Razorpay server to
  server needs PCI DSS approval. Checkout is Razorpay's page in a frame of its own: the
  buyer types the card there, picks net banking or a wallet there, and 3-D Secure runs
  at the bank. The simulated provider's card form, test-card buttons and challenge
  dialog stay with the sandbox and the simulated server.
- **The server offers one way to pay** when Razorpay's keys are set: `razorpay`. Which
  methods an order offers moved from the page to the backend (`OrderDto.paymentMethods`),
  so the page shows what it's given.
- **Paying makes a Razorpay order first,** for the order's total, outside any lock (it's
  a call over the network), once the order is known to be payable. The payment is then
  recorded under the hold's lock, where the rules check it all again, the amount
  included. A failure in between leaves Razorpay an order nobody pays. The checkout
  closes when the hold would, and a closed one reads as failed (`checkout_expired`),
  worked out when read like every other expiry.
- **Test-mode keys only.** The server refuses `rzp_live_` keys, and half a set of
  settings, at start-up.

**Two ways in, one rule**

- **Webhooks:** `X-Razorpay-Signature` is an HMAC over the raw body. It carries no
  timestamp, so a replay can't be refused for its age (the simulated provider's can).
  The event id is recorded in the transaction that acts on it, and the payment settles
  once whatever reports it: a replay changes nothing.
- **Checkout's signed result:** Checkout hands the browser the order and payment ids,
  signed with the key secret. The server checks the signature and that the order is
  this checkout's, then asks Razorpay what was paid. The browser's word alone settles
  nothing. This path also works where no webhook can arrive, as on a laptop.
- **The rule** (`domain/provider-payments.ts`): a capture for the order's open checkout,
  for its amount, takes the success path, which judges the hold by when the buyer paid.
  Any other capture is refunded and the order left alone: a checkout the buyer gave up
  on and then paid anyway, an order that moved on, the wrong amount. Authorised money is
  captured first. A failed attempt leaves the checkout open, because Checkout lets the
  buyer try another way; the checkout closing is what ends it.
- **The scheduler's sweep** asks Razorpay about checkouts that closed with no payment
  reaching us, for a day after, in case both the webhook and the result were lost.

**What's asked of Razorpay is an outbox**

Settling never calls Razorpay. It names a command (capture, refund), written with the
change, one of each kind per Razorpay payment, and sent after commit: on reads, after a
webhook or Checkout's result, and on the scheduler's run. Each command first asks
Razorpay how the payment stands, so a refund whose reply was lost isn't sent twice. A
refund is retried, at most an hour apart, and never given up on.

**Headers**

A Razorpay build names Checkout's origins in the content security policy: its script and
Razorpay's CDN (Checkout adds a risk check from it), its frames, its calls, its images.
They're named on every page, not the payment step alone: the checkout is reached
without a document load, and a document keeps the policy it was served with. The opener
policy becomes `same-origin-allow-popups`, for bank pages that report back to Checkout.
Every other build is as strict as before ([009](009-security-headers.md)).

## Consequences

- **The money rule found a real gap.** The simulated provider dropped an event for an
  order that was no longer open: harmless with no money, a kept payment with real
  money. It also found a bug that had been there all along: any command on a sold
  order failed with a 500, because writing the hold back still guarded its becoming a
  sale.
- **Tested without the network.** The server tests run on Postgres against an in-memory
  Razorpay; the end-to-end tests build server mode against a stand-in, whose
  `checkout.js` draws a dialog with what a buyer can do. Neither needs a secret, so CI
  runs both.
- **The real Checkout was opened, not paid through, by a script.** Opening it under the
  policy found the CDN script the policy blocked. Completing a payment is for a person:
  Checkout's fraud checks hold an automated browser at the card step, as they should.
- **What Checkout offers is the account's to say.** This account's test mode offered
  cards, net banking and wallets, no UPI, and the page says so.
- **Still not done:** organisers' refunds go through the sandbox only, as the dashboard
  does; Razorpay's own refunds are for money that couldn't become tickets.
