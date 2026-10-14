# Contributing

## Setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm install        # also installs the git hooks (husky)
npm run dev        # http://localhost:3000
```

No environment variables, keys or accounts are needed: the backend runs in the browser.

## Checks

| Command                             | What it checks                                                           |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `npm run format:check`              | Prettier formatting (`npm run format` fixes it)                          |
| `npm run lint`                      | type-aware ESLint: naming, layer boundaries, exhaustiveness, React rules |
| `npm run typecheck`                 | strict TypeScript                                                        |
| `npm test`                          | unit, component and HTTP-contract tests (Vitest)                         |
| `npm run build && npm run test:e2e` | browser tests against the production build (Playwright + axe)            |
| `npm run lhci`                      | Lighthouse budgets (≥ 95 in every category)                              |

CI runs all of them on every push and pull request. Locally, the pre-commit hook formats
and lints staged files, and commitlint checks the message.

## How code is written here

Read [docs/architecture.md](docs/architecture.md) for the layers and the dependency
rule, and [docs/conventions.md](docs/conventions.md) for naming, types, React, tests and
commits. When you make a decision that someone will later ask "why?" about, add a short
record to [docs/decisions/](docs/decisions) (context, decision, consequences).

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary` in the
imperative, a body that explains _why_, and `!` plus a `BREAKING CHANGE:` footer when the
API contract changes. One logical change per commit; mechanical changes (formatting, moves)
go in their own commits so the real ones stay readable.

## Review checklist

After [Google's engineering practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html):

- **Design** — does it belong in this layer, and does it respect the dependency rule?
- **Functionality** — does it do what the buyer needs, including on failure (decline,
  timeout, expiry, a duplicate webhook)?
- **Complexity** — could it be simpler? Is state a union rather than a set of flags?
- **Tests** — would they fail if the code were broken? For a bug fix, was the test run
  against the bug?
- **Naming** — does every name say what it is, with units and boolean prefixes?
- **Accessibility** — keyboard, focus, labels, announcements, contrast in both themes.
- **Comments and docs** — do comments explain _why_? Does a decision need a record?
