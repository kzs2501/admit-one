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
