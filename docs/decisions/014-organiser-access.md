# 014 — Organiser access: demo sign-in, permissions in core, and 401, 403 and 404

**Status:** Accepted

## Context

The dashboard is the first part of admit-one that isn't open to everyone. An
organiser should see their own events' orders and nobody else's, and a box-office
account shouldn't be able to refund. The sandbox has no identity provider and no
server of its own, so access has to work inside the browser without pretending to be
more secure than it is.

## Decision

- **Demo sign-in.** `POST /api/session` with a demo account's id returns a bearer
  token, sent as `Authorization: Bearer <token>` (RFC 6750).
  - Tokens are 256 random bits. They last 8 hours, worked out when read like a hold's
    expiry, and stop working on `DELETE /api/session`.
  - The token is kept per tab in sessionStorage, like the sandbox itself.
- **Permissions live in `core`,** so the dashboard and the server check the same rule.
  - `can(account, permission, event)` allows an action only on the account's own
    organisation's events, and only if its role grants the permission.
  - Owners may read, export and refund; the box office may read and export.
  - Code asks about permissions, never roles.
- **The UI hides what an account can't do; the server refuses it anyway.** The Refund
  button isn't shown to the box office, and a forced request is a 403.
- **Each status says exactly what went wrong:**
  - **401 `unauthenticated`** — no token, or one that's no longer valid.
    `WWW-Authenticate: Bearer realm="admit-one"` adds `error="invalid_token"` when a
    token was sent (RFC 6750 §3.1).
  - **403 `forbidden`** — something public, such as an event, that this account may
    not act on, or a permission its role lacks.
  - **404 `not_found`** — something private, such as an order, that belongs to another
    organiser. A 403 would confirm it exists; GitHub's API answers private resources
    the same way.
- **Every organiser answer is `Cache-Control: no-store`,** since each is private to
  one account.
- **Switching account clears everything cached** for the last one, so one organiser's
  orders are never shown to another, even while the new ones load.

## Consequences

- Tenant isolation is checked on every request, and unit and e2e tests cover the
  401, 403 and 404 cases.
- **The sandbox's honest limit:** a token in sessionStorage is readable by any script
  on the page. The content security policy ([009](009-security-headers.md)) reduces
  that risk, but a production dashboard would keep its session in an HttpOnly, Secure,
  SameSite cookie, out of reach of scripts, and defend against CSRF. The sandbox has no
  server to set such a cookie.
- **Out of scope:** real authentication (passwords, SSO, MFA), and inviting people to
  an organisation.
