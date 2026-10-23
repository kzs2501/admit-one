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
| `npm run test:server`               | the server backend against real Postgres (starts one if none is running)   |
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

## Server mode

`NEXT_PUBLIC_BACKEND=server` builds the app against Next route handlers and Postgres
([ADR 018](docs/decisions/018-server-mode.md)). Postgres comes from the
`embedded-postgres` package, so `npm run db:up` (then `npm run db:migrate`) is all it
takes; `npm run db:down` stops it. `npm run test:server` starts a temporary one by itself
if none is running.

- **A schema change:** edit `src/backend/postgres/schema.ts`, then `npm run db:generate`,
  and commit the SQL migration it writes.
- **A rule change** goes in the sandbox's domain (`src/backend/domain`): the server runs
  the same functions on its own rows, so both backends change together. Only stock and
  seats are the server's own (`src/backend/postgres/stock.ts`).
- **A race test** must use a test database's whole pool at once (`createTestDatabase`
  opens every connection first), and must fail against a version without its guard.
- **An end-to-end test** that a buyer could run against either backend gets
  `{ tag: "@both" }`; `npm run build:server && npm run test:e2e:server` runs those on
  server mode.

## Offline, and the door scanner

[ADR 019](docs/decisions/019-offline-tickets-and-door-scanner.md) has the design.

- **The service worker** is `public/sw.js`, plain JavaScript that the browser runs as
  it is. It caches nothing in development, so `npm run dev` never serves a stale file.
  To try offline, build and start the app (`npm run build && npm start`); DevTools →
  Application → Service workers shows it, and its caches are under Cache storage.
- **Changing what it caches?** Bump `VERSION` in `sw.js`: activating deletes every other
  version's caches.
- **The scanner's QR reader** (`zxing_reader-<version>.wasm`) is copied into
  `public/vendor/` after every install. If `/scan` says the reader didn't load, run
  `npm install` again.
- **The camera test** (`e2e/camera.spec.ts`) has a Playwright project of its own, in
  full Chromium, which Playwright's `chromium` install includes: the headless shell it
  runs by default has no camera.
- **Server mode in production** needs a ticket key pair. Make one with
  `node -e 'const k=require("crypto").generateKeyPairSync("ed25519").privateKey.export({format:"jwk"});console.log("TICKET_SIGNING_KEY="+k.d+"\nNEXT_PUBLIC_TICKET_PUBLIC_KEY="+k.x)'`.
  The first is a secret, for the server; the second is public, built into the scanner.

## Server mode's settings

In development and tests the server has a stand-in for each of these. In production
(`NODE_ENV=production`) it refuses to start without the required ones, and says which
are missing ([ADR 018](docs/decisions/018-server-mode.md)).

| Variable                                                     | Needed                   | What it is                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_BACKEND=server`                                 | at build                 | Builds the app against the server rather than the sandbox                                                                                                                                                                                                      |
| `DATABASE_URL`                                               | yes                      | Postgres; migrate it with `npm run db:migrate`                                                                                                                                                                                                                 |
| `WEBHOOK_SECRET`                                             | yes                      | Signs and checks the payment provider's webhooks                                                                                                                                                                                                               |
| `TICKET_SIGNING_KEY`                                         | yes                      | The Ed25519 key tickets are signed with (made above)                                                                                                                                                                                                           |
| `NEXT_PUBLIC_TICKET_PUBLIC_KEY`, `NEXT_PUBLIC_TICKET_KEY_ID` | at build                 | The scanner's copy of the public key, and its id                                                                                                                                                                                                               |
| `TICKET_KEY_ID`                                              | no (`server-1`)          | The key id written into tickets; checked at start-up                                                                                                                                                                                                           |
| `FINGERPRINT_SECRET`                                         | yes                      | Any long random string: the key for the HMAC that tells a retried payment from a reused Idempotency-Key. What's stored is that keyed hash of the request, CVC left out, which PCI DSS allows; a plain hash of a card number can be reversed by trying them all |
| `CRON_SECRET`                                                | for scheduled deliveries | Turns on `GET /api/internal/deliver`, for a scheduler to call every minute or so with `Authorization: Bearer <secret>`                                                                                                                                         |

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
