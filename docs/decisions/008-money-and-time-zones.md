# 008 — Currency and time zone are data

**Status:** Accepted

## Context

Every price was formatted as USD in `en-US`, and every date in a hard-coded
`Asia/Kolkata`, while the venues are in Pune, Goa and Jaipur. Amounts were `*Cents`,
which presumes a currency.

## Decision

Following Fowler's Money pattern, an amount travels with its currency:

- Each event carries `currency` (ISO 4217) and `timeZone` (IANA).
- `Amounts` carries its `currency`, and every field is `*Minor`, an integer in minor
  units (paise, cents).
- `formatMoney(amountMinor, currency)` takes the currency's decimal places from `Intl`.
- Event times are formatted in the event's own time zone, in the `en-IN` display locale.
- The Indian venues are priced in INR.

## Consequences

- Nothing assumes a currency or a zone, so an event elsewhere is a data change.
- Amounts render with Indian digit grouping (₹11,22,494.00).
- The fee rule is unchanged: 3%, rounded half-up in integer arithmetic.
