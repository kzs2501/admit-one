# Conventions

How code in this repository is written, why, and what enforces it. Where a rule can be
checked by a tool it is; the rest is for review.

**Sources:** [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) ·
[Fowler & Qiu, _Modularizing React Applications_](https://martinfowler.com/articles/modularizing-react-apps.html) ·
[Bulletproof React](https://github.com/alan2207/bulletproof-react) ·
[react.dev: _You Might Not Need an Effect_](https://react.dev/learn/you-might-not-need-an-effect) ·
[TkDodo, _The Query Options API_](https://tkdodo.eu/blog/the-query-options-api) ·
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) ·
[Stripe, _Idempotency_](https://stripe.com/blog/idempotency) ·
[Alexis King, _Parse, don't validate_](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) ·
[Playwright best practices](https://playwright.dev/docs/best-practices) ·
[Testing Library guiding principles](https://testing-library.com/docs/guiding-principles) ·
[Conventional Commits](https://www.conventionalcommits.org) ·
[Google engineering practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html)

## Naming

| Rule                                                                                           | Example                                                 | Source             | Enforced by                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| Files and folders are kebab-case; a file's main export is named after it                       | `order-status-view.tsx` → `OrderStatusView`             | Google             | review                                                       |
| Types, interfaces and components are `PascalCase`                                              | `CheckoutState`, `TierPicker`                           | Google             | `naming-convention`                                          |
| Values and functions are `camelCase`                                                           | `formatMoney`, `holdQueries`                            | Google             | `naming-convention`                                          |
| Module-level immutable tables and tunables are `CONSTANT_CASE`                                 | `CATALOG`, `PRESETS`, `SLOW_CONFIRMATION_MS`            | Google             | `naming-convention` (format), review (choice)                |
| Booleans start with `is`, `has`, `can`, `should`, `did`, `was` or `are`                        | `isBusy`, `hasConfirmedAddOns`, `shouldRedirect`        | —                  | `naming-convention` (variables, parameters, type properties) |
| A string that sounds like a boolean gets a noun name                                           | `declineMessage`, not `declined`                        | —                  | review                                                       |
| Every number with a unit says it                                                               | `holdDurationMs`, `priceMinor`, `deliverAtMs`           | —                  | review                                                       |
| Lookups: `find*` may return `undefined`; `get*` returns or throws                              | `findEvent`, `getEvent`                                 | —                  | review; removes every `!`                                    |
| Factories `create*`, mappers `to*`, predicates `is*`/`can*`/`has*`, hooks `use*` in `use-*.ts` | `createBackend`, `toOrderDto`, `isAwaitingConfirmation` | React, Google      | `rules-of-hooks`, review                                     |
| No ambiguous abbreviations or single letters outside indices                                   | `quantity` not `qty`, `context` not `ctx`               | Google             | review                                                       |
| API operations use standard verbs                                                              | `listEvents`, `getHold`, `createPayment`, `upsertOrder` | Google AIP-131–135 | review                                                       |
| Error codes are `snake_case`; problem types are absolute URLs to `/problems/kebab-case`        | `sold_out` → `<origin>/problems/sold-out`               | Stripe, RFC 9457   | `problemSchema`                                              |

## Structure

- **Layers and the dependency rule** are in [architecture.md](architecture.md) and
  enforced by `import/no-restricted-paths`. Features never import each other.
- **Named exports only**, except where Next.js requires a default (`app/**`, configs) —
  `import/no-default-export`.
- **No barrel files.** Import the module you need; the backend's `index.ts` is a port,
  not a barrel.
- **Imports:** `@/` across folders, `./` within one. Type-only imports say so —
  `consistent-type-imports`.

## Types

- `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns` and
  `noFallthroughCasesInSwitch`.
- **Zod comes from `@/core/zod`**, never `"zod"` (`no-restricted-imports`): it's
  configured there, before any schema exists, not to probe for `eval`, which the
  Content Security Policy forbids.
- **Parse at every trust boundary** with Zod: request bodies (backend), responses and
  problems (client), persisted state and drafts (storage). Inside the boundary, trust
  the types.
- **No `any`, no `!`, no `as` on data.** A cast appears only where a library's types
  require it (`as Route` in `lib/routes.ts`, the one place dynamic hrefs are built).
- **Unions over flags.** State that can be one of several things is a discriminated
  union, rendered with an exhaustive `switch` — `switch-exhaustiveness-check`.
- Object shapes are `interface`s; unions and derived types are `type`s —
  `consistent-type-definitions`.

## React

- **Components render; hooks decide.** Rules, fetching and side effects live in
  view-model hooks that return one state; components switch over it.
- **Derive, don't sync.** Values computed from props or state are computed in render.
  Effects only synchronise with something outside React (the router, a timer, a
  subscription, the DOM's focus).
- **Queries** come from `lib/queries.ts` factories (`queryOptions`), so cache keys can't
  drift and `setQueryData` is typed.
- **A failed refresh never wipes good data.** A query's error replaces the screen only
  when there's no data yet, or when it's an answer (a 4xx problem such as `not_found`) —
  `shouldShowQueryError`. Glitches while refreshing are reported once, as a toast, from
  the `QueryCache` ([TkDodo](https://tkdodo.eu/blog/react-query-error-handling)).
- **Large interactive lists** (the seat map's thousand cells) handle events once, on
  the container, reading `data-*` ids (delegation), and render memoised cells with
  primitive props, so a change re-renders only what changed. A budget test keeps it
  honest.
- **Links** use `lib/routes.ts`; `typedRoutes` checks every literal href at build time.
- **Accessibility is a feature:** native elements first (`<dialog>`, `<fieldset>`,
  `<output>`); errors are linked to their fields; focus moves to what changed;
  announcements go through polite live regions, and only when they matter.

## Tests

- `<module>.test.ts(x)` next to its module; `describe(<unit>)`;
  `it("<behaviour, present tense>")`.
- Test behaviour through public APIs, the way a user or caller would; query the DOM by
  role and label.
- Every test must be able to fail: when adding one for a bug, run it against the bug
  first.
- Browser tests use the `buyer` and `sandbox` page objects from `e2e/fixtures.ts`, and
  import shared values (storage key, test cards) from `src` instead of copying them.
- Browser tests never wait on the clock: they wait for what they need (a web-first
  assertion, an animation's `finished`). `eslint-plugin-playwright` enforces this, and
  catches floating promises and conditional assertions.

## Formatting and commits

- Prettier, 120 columns, Tailwind classes sorted — `format:check` in CI, `lint-staged`
  on commit.
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `build:`, `style:`, `chore:`), with `!` and a `BREAKING CHANGE:` footer for breaking
  changes — commitlint on every commit and in CI. The body says _why_.
