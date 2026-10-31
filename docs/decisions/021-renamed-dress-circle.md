# 021: Renamed to Dress Circle; the names already stored stay

**Status:** Accepted.

## Context

The app was called admit-one, the line printed on a paper ticket. As a name it was a
stock phrase anyone can use, the hyphen read like a code slug, and "one" undersold an
app built for a crowd arriving at once. It is now **Dress Circle**, the first balcony in
a theatre and a seat class at India's single-screen cinemas: it names the seat map, the
app's most visible feature, and the market it sells in.

Some of the old name had already left the codebase: it is stored on people's devices and
printed into tickets.

## Decision

**Everything a person reads says Dress Circle:** page titles, the header, the manifest,
the scanner's messages, the UPI payee and Razorpay's checkout. So do the names only
developers see: test origins, the auth realm, local database names, the package.

**Names already stored keep the old one,** and live in one module,
`src/core/persisted-names.ts`:

- the sessionStorage and localStorage keys (`admit-one:sandbox:v*`, `:draft:`, `:queue:`,
  `:organiser-session`, `:door-event`);
- the IndexedDB databases (`admit-one-wallet`, `admit-one-door`, `admit-one-door-voids`);
- the service worker's caches and its message (`public/sw.js` spells these itself, as
  plain JavaScript);
- the ticket format `ao1` ([019](019-offline-tickets-and-door-scanner.md)).

Renaming any of them would quietly empty the wallet, the door's memory or the offline
pages on every device that has them, or turn every ticket already issued into "not a
ticket". A test pins each name, the service worker's included, so changing one has to be
a decision, not a side effect of find-and-replace.

## Consequences

- A reader will meet `admit-one` in storage code; the module's comment and this record
  say why.
- The hosting moves to the new name separately (the repository, the Vercel projects, the
  webhook URL), with the old addresses redirecting, so links already shared keep working.
- The local Postgres role stays `admit`: renaming it would re-create every developer's
  local cluster for no gain.
