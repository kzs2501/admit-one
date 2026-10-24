# Security

## Reporting a vulnerability

Please report it privately: on GitHub, open this repository's **Security** tab and
choose **Report a vulnerability**. Please don't open a public issue. You'll hear back
within a week.

## What's in scope

admit-one is a demo. Its backend runs in the visitor's browser, and there are no real
payments, accounts or personal data. The reports that matter most are anything that
runs script in another visitor's page, weakens the security headers
([ADR 009](docs/decisions/009-security-headers.md)), or exposes the CI pipeline.

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
