# 006 — Errors are RFC 9457 problem details

**Status:** Accepted

## Context

Errors were `{ error: { code, message, details } }`, with `code` a plain string, and the
UI branched on HTTP status in some places and on `code` in others. `details` was
`Record<string, unknown>`, so reading how many tickets were left meant coercing with
`String()` and `Number()`.

## Decision

Errors are `application/problem+json`
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)): `type`, `title`, `status`,
`detail` and `instance`, plus a machine-readable `code`. Some problems carry typed
extension members, such as `sold_out` with `tierId` and `available`.

- The contract defines the problems as a Zod discriminated union on `code`, with one
  catalogue of status and title per code.
- The domain returns `DomainError`: the problem minus its transport members. It never
  picks a status; the HTTP adapter does.
- Each `type` is an absolute URI on the API's own origin — `<origin>/problems/<slug>`,
  the code in kebab-case — pointing at a page generated from the catalogue, so every
  type dereferences to its documentation. `instance` is the request's absolute URL. The
  RFC recommends absolute URIs for both; the client's schema requires them.
- The client parses error bodies against the schema. The UI switches on `code`,
  exhaustively; network failures and contract violations are a separate `NetworkError`.

## Consequences

- Adding a problem is one schema entry and one catalogue entry, and the compiler and
  the tests point at everything else.
- Branching is typed end to end: `if (problem.code === "sold_out") problem.available`.
- It's a breaking change to the error body; this project has no external clients yet.
