# 007 — A schema-first contract, with ISO 8601 timestamps

**Status:** Accepted

## Context

Response types were TypeScript-only, so the client cast whatever arrived (`body as T`),
and API paths were written twice, in the client and in the handlers. Timestamps were
epoch milliseconds named `createdAt`, so the unit lived only in people's heads.

## Decision

- Zod schemas in `src/contract/` are the source of truth for every request and response;
  the types are inferred from them. The handlers parse requests against them, and the
  client parses responses against them: parse, don't validate, at both ends.
- One route table (`API_ROUTES`) serves both sides, with typed params.
- Timestamps on the wire are ISO 8601 strings. Inside the backend they are epoch
  milliseconds, and the field names say so (`createdAtMs`); the HTTP mappers convert
  between the two.

## Consequences

- A response that breaks the contract is caught at the boundary, as a `NetworkError`
  with a clear message, instead of surfacing as a confusing UI bug three components
  later.
- A path, field or status can't drift between the client and the server.
- Parsing costs a few microseconds per response; Lighthouse is unchanged at 100.
