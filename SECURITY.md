# Security

## Reporting a vulnerability

Please report it privately: on GitHub, open this repository's **Security** tab and
choose **Report a vulnerability**. Please don't open a public issue. You'll hear back
within a week.

## What's in scope

admit-one is a demo with no real payments or accounts. Its public build runs its
backend in the visitor's own browser; built in server mode, it runs the same API on a
server, over Postgres ([ADR 018](docs/decisions/018-server-mode.md)). The reports that
matter most are anything that runs script in another visitor's page, lets one client
harm a sale or another buyer in server mode, weakens the security headers
([ADR 009](docs/decisions/009-security-headers.md)), or exposes the CI pipeline.

## Threat model

What an attacker could want here, and what stands in the way. Reviewed on 2026-10-24;
the review's findings and fixes are in the commits from `fix(deps): next 16.4.3` to
`docs(security)`.

**What's worth protecting**

- **The sale:** tickets and seats can't be oversold, held hostage or bought without
  paying.
- **Buyers' data:** names, emails and the last four digits of a card. Full card numbers
  and CVCs are never stored, logged or hashed without a key.
- **Tickets:** a ticket can't be forged or changed, and a refunded one stops working at
  the door.
- **The pipeline:** CI and its dependencies can't be used to ship something else.

**Two ways it runs.** In the sandbox, the backend runs in the visitor's own browser, so
the only person a server-side flaw could harm is the visitor themselves. In server
mode, `/api/*` is a real server on Postgres, and everything below applies.

**What stands in the way**

| Threat                                  | Defence                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overselling under concurrency           | Conditional updates and a unique index in Postgres ([ADR 018](docs/decisions/018-server-mode.md))                                                                                                          |
| Holding every ticket (scalping)         | A per-client rate limit on reserving, in Postgres, keyed by the IP a trusted proxy reports                                                                                                                 |
| Paying twice, or replaying a payment    | Idempotency-Keys, claimed before the work and owned by their claim; the request compared by an HMAC without the CVC                                                                                        |
| Card data on this server                | None: with Razorpay, cards are typed into Razorpay's own frame; the simulated provider's card form is the sandbox's and the simulated server's                                                             |
| Forged or replayed Razorpay payments    | Checkout's result is checked against its signature, then against Razorpay itself; a webhook is checked over its raw body, and acted on once by its event id                                                |
| Keeping money that can't become tickets | Every capture that can't is refunded through Razorpay's API, from an outbox that retries and never refunds twice                                                                                           |
| Forged or replayed webhooks             | HMAC-SHA256 over the raw body, a five-minute tolerance, a constant-time compare, and each event acted on once                                                                                              |
| Changing the price                      | Prices are worked out on the server from the catalogue; quantities, attendees and add-ons are checked against the hold                                                                                     |
| Forged tickets                          | Ed25519 signatures, checked at the door with public keys only; a production door never trusts the demo key                                                                                                 |
| Refunded tickets                        | Voided where they're refunded (the organisers' dashboard, sandbox only for now), and refused at doors that have synced the event's list                                                                    |
| Script in someone else's page           | React escapes text, and nothing renders HTML from data; the CSP loads scripts from this site only (inline ones are allowed, as below)                                                                      |
| Clickjacking, sniffing, leaky referrers | `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin`, HSTS                                                                                                                               |
| Exhausting the server                   | 64 KB bodies, cut off as they arrive; bounded lengths and counts; Next's image optimiser off (on Vercel, the platform's own resizer answers instead, for this site's images only: no SVGs, no other sites) |
| Leaking data through errors             | Problems say what went wrong in general; logs name the query that failed, never its values                                                                                                                 |
| A poisoned offline cache                | The service worker caches only this site's content-hashed files, and only successful answers                                                                                                               |
| The supply chain                        | Locked dependencies, a production audit in CI, actions pinned by commit, least-privilege workflows, CodeQL                                                                                                 |

**Accepted, on purpose**

- **Inline scripts are allowed** (`'unsafe-inline'`): nonces would make every page render
  on demand ([ADR 009](docs/decisions/009-security-headers.md)). It matters only if
  something injects HTML, and nothing renders HTML from data.
- **An order's id is its key:** whoever has an order's link can see it, as with most
  ticket links. Ids carry 60 random bits.
- **The simulated 3-D Secure check** can be approved by whoever holds the payment's id.
  It stands in for the bank's page, in the sandbox; with Razorpay, the check runs at the
  card's issuer.
- **A Razorpay build lets Razorpay's origins in** to its content security policy, on every
  page, since the checkout is reached without a document load. They serve only
  Razorpay's code, which loads when a buyer presses Pay ([ADR 020](docs/decisions/020-razorpay-test-mode.md)).
- **Razorpay's webhooks carry no timestamp,** so a replay can't be refused for its age; it
  finds its event recorded, or its payment settled, and changes nothing.
- **The sandbox's organiser sign-in** keeps its token where scripts can read it, and is a
  demo account in the visitor's own browser.
- **The demo ticket key is public,** so anyone can sign tickets the sandbox's door accepts.
  That's the honest limit of a backend in the browser; a server signs with its own key.
- **Without a trusted proxy,** the server can't tell clients apart and doesn't rate-limit
  reserving; it says so when it starts.

## Dependencies

- **What ships has no known vulnerabilities.** CI runs `npm audit --omit=dev
--audit-level=high` on every change, and Dependabot proposes updates weekly.
- **Development tools are patched where a fix exists.** `overrides` in `package.json`
  pins patched versions deep in the Lighthouse CI chain (`basic-ftp`, `tmp`, `uuid`),
  and a current `esbuild` under `drizzle-kit`'s config loader, where the tools that use
  them haven't caught up yet.
- **Two advisories have no fix yet**, both in development tools that never see
  untrusted input:
  - `extract-zip` ≤ 2.0.1, the latest release (symlink path traversal), comes with
    Puppeteer. Puppeteer only uses it to unpack a Chrome it downloads, and these
    tools never download one: Lighthouse CI and the browser tests run a Chrome that's
    already installed.
  - `zod` 3.x (memory exhaustion on oversized collections), under Puppeteer's
    WebDriver BiDi client. Lighthouse drives Chrome over the DevTools protocol, so
    that client isn't used, and its input would be the local browser's own messages.
    The app's own Zod is 4.x, which isn't affected.
