# Contributing

## Setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm install        # also installs the git hooks (husky)
npm run dev        # http://localhost:3000
```

No environment variables, keys or accounts are needed: the backend runs in the browser.

## Checks

| Command                             | What it checks                                                             |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `npm run format:check`              | Prettier formatting (`npm run format` fixes it)                            |
| `npm run lint`                      | type-aware ESLint: naming, layer boundaries, exhaustiveness, React rules   |
| `npm run typecheck`                 | strict TypeScript                                                          |
| `npm test`                          | unit, component and HTTP-contract tests (Vitest)                           |
| `npm run test:coverage`             | the same, failing if coverage drops below its floors (`vitest.config.mts`) |
| `npm run build && npm run test:e2e` | browser tests against the production build (Playwright + axe)              |
| `npm run test:stories`              | every story in the catalogue renders, passes its play function and axe     |
| `npm run test:visual`               | screenshots of every story, in Playwright's Linux image (needs Docker)     |
| `npm run lhci`                      | Lighthouse budgets (≥ 95 in every category)                                |

CI runs all of them on every push and pull request. Locally, the pre-commit hook formats
and lints staged files, and commitlint checks the message.

## The component catalogue and its screenshots

`npm run storybook` opens the catalogue at http://localhost:6006. Each component and
screen has a story for every state it can be in ([ADR 017](docs/decisions/017-catalogue-and-visual-tests.md)).

- **New state, new story.** A screen that renders a state (`CheckoutView`,
  `OrderStatusScreen`) gets its data from `features/*/testing/story-fixtures.ts`, which
  a unit test parses with the contract's schemas. A component that fetches its own data
  runs on the story's own sandbox; set the scene in the story's `beforeEach`, over HTTP.
- **Screenshots compare only in Playwright's Linux image, on arm64,** the same as CI.
  On a Mac, install Docker (`brew install colima docker`, then `colima start`), and run
  `npm run test:visual`. It builds the catalogue, runs the browser in the image, and
  writes the baseline of any new story. Docker's VM holds its memory while it runs, so
  `colima stop` when you're done.
- **Changed something on purpose?** `npm run test:visual -- --update-snapshots=changed`,
  then look at every changed image before committing it. On a failure, the HTML report
  (`playwright-report/visual`) shows the expected image, the actual one and the diff.
- **"Failed to fetch dynamically imported module"** right after adding an import to a
  story means Vite re-optimised its dependencies mid-run. Run the stories again.

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
