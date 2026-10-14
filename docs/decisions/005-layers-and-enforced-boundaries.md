# 005 — Layers, with boundaries the linter enforces

**Status:** Accepted

## Context

The first version grouped code by folder (`server/`, `mocks/`, `components/`), and its
README claimed you could swap in a real backend by replacing `src/mocks/`. That wasn't
true: the API client imported the mock worker, the chaos panel reached into the server's
internals, and `components/` and `checkout/` imported each other. Boundaries that are
only described in prose decay.

## Decision

Organise by layer and by feature (after Bulletproof React's unidirectional
architecture, Fowler and Qiu's _Modularizing React Applications_, and Cockburn's ports
and adapters):

| Layer                    | Holds                                                                     | May import                          |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------- |
| `core/`                  | the shared kernel: catalogue, money, statuses, validation                 | nothing else                        |
| `contract/`              | the HTTP contract: routes, DTO and request schemas, problem types         | `core`                              |
| `backend/`               | the simulated service: domain, HTTP adapter, runtime                      | `core`, `contract`                  |
| `lib/`, `components/ui/` | the API client, routes, queries, formatting, UI primitives                | `core`, `contract`                  |
| `features/*`             | events, checkout, orders, sandbox: hooks own the rules, components render | the above, never each other         |
| `app/`                   | routes: composes features                                                 | everything except backend internals |

The app reaches the backend only over HTTP. The one exception is the sandbox feature,
which drives the chaos panel through the backend's public port (`@/backend`). The rule
is written as `import/no-restricted-paths` zones in `eslint.config.mjs`, alongside
`import/no-cycle`.

## Consequences

- A forbidden import fails `npm run lint` and CI, with a message saying why. All
  three kinds were tried and rejected before this was accepted.
- Swapping in a real backend is now actually a deletion.
- Features share through `core`, `lib` and `components`, which keeps the shared layers
  small and deliberate.
