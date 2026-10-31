# 017 — A catalogue of states, and screenshots made on one machine

**Status:** Accepted

## Context

Dress Circle's screens are driven by view-model hooks that return one state at a time
(`CheckoutState`, `OrderPageState`). Many of those states are hard to reach by clicking:
a failed load, a hold in its last minute, a payment slow to confirm, a UPI request
waiting in another app.

The end-to-end tests check behaviour, but nothing checked what each state looks like,
in both themes, or caught a style change that moved something by a pixel.

## Decision

**The catalogue**

- **Storybook 10** (`@storybook/nextjs-vite`), which supports Next 16, Vite 8 and React 19. Stories use the root layout's fonts (`src/app/fonts.ts`), `globals.css` and the
  app's own providers.
  - The providers are keyed by story, so no cached data leaks from one story to the next.
- **Screens render a state.** `CheckoutView` and `OrderStatusScreen` take the state as a
  prop, and the containers (`CheckoutFlow`, `OrderStatusView`) only call the hooks.
  Every state is then a story built from data.
- **Fixtures come from the real rules.**
  - They're priced by `core/pricing.ts`.
  - The states come from the real `deriveCheckout` and `toOrderPageState`, and a fixture
    that can't reach the state its story claims throws.
  - A unit test parses every story's data with the contract's Zod schemas, so an API
    change breaks the fixture rather than leaving the catalogue showing data the server
    could never send.
- **Components that fetch their own data run on the real sandbox.** The seat map, the
  waiting room and the organisers' dashboard are shown against a fresh simulated backend
  for every story, behind the same MSW handlers as the app, with deterministic ids.
  - Stories set the scene over HTTP, as a client would: signing in, joining the queue,
    reserving.
  - Stories never import `backend/`, so the layer rules hold. The harness lives in
    `.storybook/sandbox.ts`.
  - Storybook's docs prefer args to loaders, and loaders run in parallel, so set-up is a
    `beforeEach` (with a clean-up).
- **Every story is a test,** through the Vitest addon in Chromium. It must render, pass
  its play function, and have no axe violations (`a11y.test: "error"`).
  - Unit tests keep their own Vitest project and coverage floors.
  - **What a play function can't check:** Storybook's `userEvent` dispatches events from
    script, and a native `<dialog>` closes on Escape only for a real key press. So
    Escape is left to the end-to-end tests.
- **Foundations pages** show the colour tokens and the type scale, and render every text
  colour on every surface the UI uses it on, so axe's contrast rule checks each pairing.

**Screenshots**

- **Playwright `toHaveScreenshot`** over the static build: one test per story in
  `index.json`.
  - Light and dark, by emulating `prefers-color-scheme`, as the app themes itself.
  - Stories tagged `screen` are taken full-page, and again at 375 px. Components are
    clipped to the story.
  - axe runs on every story in both themes.
  - Chosen over Chromatic or Argos: free, self-hosted, and its HTML report has a diff
    viewer.
- **Baselines are made, and compared, on one machine:** Playwright's Linux image, on
  arm64.
  - Screenshots differ between operating systems, and also between CPU architectures:
    Playwright's maintainers say ARM and Intel images render differently (microsoft/
    playwright #13873).
  - **Emulation is no way round it.** In the amd64 image under Rosetta on Apple Silicon,
    Chromium renders OKLCH colours as transparent and takes white screenshots
    (docker/desktop-feedback #686). Every token here is OKLCH.
  - So: `npm run test:visual` runs the browser in that image on an Apple-silicon laptop
    (Colima, `playwright run-server`, with the Mac's localhost exposed to it), and CI
    runs the same image on `ubuntu-24.04-arm`, which is free for public repos.
  - A unit test keeps CI's image tag equal to the installed Playwright, and the config
    refuses to run against any browser but Linux.
- **What makes a screenshot repeatable:**
  - the clock is fixed (`page.clock.setFixedTime`); fixtures are relative to now, so
    they're fixed too, and live Storybook still looks right;
  - animations are disabled and the caret hidden;
  - fonts have loaded;
  - ids and randomness in the story backend are seeded.
- **What makes it settled:** stable isn't enough. `toHaveScreenshot` waits for two
  identical frames, and a loading spinner, with animation off, is identical in both.
  So each test also waits for:
  - Storybook's render phase to finish, which includes the play function. This is
    Storybook's internal state, read in one place (`visual/story.ts`).
  - The preview's idle probe (`data-story-idle`) to be true at two frames in a row: no
    query or mutation in flight. (Until 2026-10-23 it looked only at the second frame,
    so a request that started and finished in between got through.)
- **Missing baselines** are written locally for review, and fail CI.

## Consequences

- **98 stories,** each a Vitest test, and **210 screenshots** so far (85 per theme, plus
  40 screens at 375 px). The 13 newest stories' baselines are still to be made in the
  image, where they can only be made. A one-pixel style change fails with a diff in the
  report.
- **It found two bugs in its first week:**
  - **Focus rings that `outline-none` didn't remove.** Headings focused from code (so
    screen readers announce them) showed a ring. The global `:focus-visible` rule was
    outside any cascade layer, and unlayered styles beat Tailwind's utilities. The rule
    now lives in `@layer base`.
  - **Busy buttons dropped keyboard focus.** A repeat run found one flaky screenshot:
    after Reserve, the button sometimes had focus and sometimes not. A busy button was
    `disabled`, and Chromium moves focus off an element that becomes disabled, but only
    if it renders in between. A busy button is now `aria-disabled` and refuses presses
    itself, so it keeps focus, and Enter in its form still can't submit twice.
- **Baselines can only be updated in the image:** `npm run test:visual --
--update-snapshots=changed`, then review the diff before committing.
- **Out of scope:**
  - Firefox and WebKit screenshots;
  - screenshots of whole routes (screens are composed of storied parts);
  - an in-app theme switch, which would need `light-dark()` tokens (Safari 17.5+);
  - publishing the Storybook.
