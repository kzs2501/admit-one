# 009 — Security headers, and a Content Security Policy without nonces

**Status:** Accepted

## Context

The app sent no security headers. A Content Security Policy is the main defence in
depth against injected scripts, but Next.js offers two ways to set one: a per-request
nonce, set in `proxy.ts`, which forces every page to render dynamically; or a static
header from `next.config.ts`, which then has to allow Next's inline bootstrap scripts.
Most pages here are static, and their speed is part of the point.

## Decision

- A static policy, after Next's "Without Nonces" recipe, sent by `headers()` with every
  response: `default-src 'self'`; scripts from this origin plus `'unsafe-inline'`
  (`'unsafe-eval'` in development only, for React's tooling); `connect-src 'self'`;
  `worker-src 'self'` for the simulated backend's service worker; `object-src 'none'`;
  `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`.
- Alongside it: `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, a
  `Permissions-Policy` that turns off camera, microphone, geolocation and topics,
  `Cross-Origin-Opener-Policy: same-origin`, and `X-Frame-Options: DENY` for browsers
  that predate `frame-ancestors`. `X-Powered-By` is off.
- No `upgrade-insecure-requests`: the tests and Lighthouse run over `http://localhost`.
  HTTPS is the host's job — Vercel sends HSTS on its domains.
- An end-to-end test checks the headers, completes a purchase with no violations, and
  proves enforcement by watching the browser refuse a cross-origin connection.

## Consequences

- `'unsafe-inline'` means the policy doesn't stop an injected inline script. Everything
  else does real work: no foreign scripts, connections, plugins, form targets, base
  URLs or framing. If the app ever renders untrusted HTML, switch to nonces and accept
  dynamic rendering.
- A new third party — a payment provider's hosted fields, an analytics endpoint — needs
  its origins added to the policy, and the e2e test fails until they are.
- Vercel's preview-only toolbar loads from `vercel.live`, which the policy blocks. It
  isn't widened for previews: production is what the policy protects.
