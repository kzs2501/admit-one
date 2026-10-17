# 010 — Reserved seating: an HTML grid, static halls, server-chosen seats

**Status:** Accepted

## Context

Every event was general admission: a buyer chose "2 × General". Reserved seating raises
questions general admission never did:

- how to draw about a thousand seats so a keyboard or screen-reader user can choose one;
- where a hall's layout lives;
- who decides which seats a buyer gets when they don't mind;
- what happens when two buyers want the same seat;
- how to add all this without breaking the API's existing clients.

## Decision

- **A hall is static data; availability is live.** A layout is sections of rows of
  blocks between aisles (`core/venues.ts`), expanded once into seats with a hall-wide
  `column`, so rows of different lengths line up. It ships with the app, like the
  catalogue, and the event page renders it on the server. The API sends only what
  changes: `GET /api/events/:slug/seats` lists the seats that are gone. The map polls
  it every 5 seconds, paused while the tab is hidden.
- **The map is HTML, not SVG or canvas.** It's one WAI-ARIA `grid` per section, with a
  `rowheader` per row and a `gridcell` per seat. HTML gives native focus, hit-testing
  and target size. Screen-reader support for ARIA roles inside SVG is uneven, and canvas
  has no semantics at all.
- **Keyboard, after the APG grid pattern.**
  - Each grid is one tab stop (roving tabindex).
  - Arrows step over aisles; Up and Down go to the seat nearest in column, which is the
    seat in front, not the one with the same number.
  - Home/End, Ctrl+Home/End and Page Up/Down; Space or Enter chooses.
  - The model is a pure function, tested key by key.
  - Taken seats stay focusable and are `aria-disabled`, so the whole hall can be
    explored by ear.
- **Seen and heard, not just coloured.** Each state has a glyph as well as a colour,
  with forced-colors styles. The top price tier is tinted, and the legend gives every
  tier's rows and price in words. Seats are 28–44 px (WCAG 2.5.8). A scroll margin
  keeps keyboard focus clear of the sticky "Your seats" bar (WCAG 2.4.11).
- **A thousand cells stay fast.** Clicks, keys and focus are handled once per grid
  (event delegation), and each cell is memoised with primitive props, so choosing a
  seat re-renders that seat. An e2e test holds the longest interaction under 200 ms
  with the CPU throttled four times; it measures 56 ms.
- **The selection is derived, not synced.** The client keeps a list of chosen ids.
  Which of them someone has taken since, and which seat they'd strand, are derived in
  render from the latest availability.
- **Holds by seat are all-or-nothing.** If any chosen seat is gone, nothing is held, and
  `409 seats_unavailable` lists the gone seats so the map can deselect exactly those.
- **One single-seat-gap rule, in `core`.** A selection may not strand one free seat
  against a taken seat, an aisle or a row end. The client uses the rule to explain
  before the buyer asks; the server enforces it with `422 single_seat_gap`.
- **The server chooses "best available".** The by-tier request (`{ eventSlug, items }`)
  makes the server pick, in the same step as the hold, so no one can take the seats in
  between. It picks the row nearest the stage with the party together in one block, as
  central as possible without stranding a seat. Failing that, it picks the best seats
  apart.
- **The contract only grows.** The by-tier request is unchanged, and the new
  `{ eventSlug, seatIds }` shape is strict. The two are told apart by `seatIds`, not by
  trying both, so errors speak to the shape the client meant. Responses gain `seating`,
  `seats` and a ticket's `seat`; clients that don't know them ignore them. The persisted
  sandbox moves to v5 (ADR 001).

## Consequences

- One description of each hall serves the server, the map, the allocator and the
  tests. Changing a hall means a deploy; a production system would serve layouts from
  the API, versioned, and keep the same client.
- Server-rendering about a thousand cells costs page weight: 480 KB of HTML (17 KB
  gzipped) and 1,850 DOM elements. Desktop Lighthouse: 100 in every category, CLS 0. Mobile
  performance is 86–92, the same range as the general-admission pages. On those pages,
  Lighthouse's simulated LCP is bound by the JavaScript the whole app ships; that's a
  separate, tracked gap. If halls grow, sections can render as they near the viewport,
  behind placeholders of known size.
- Availability can be up to 5 seconds stale. That's safe, because the hold is the
  check: a seat taken in the meantime comes back as `seats_unavailable`, by name.
- Checked so far: axe in both themes with seats chosen, the accessibility tree,
  keyboard-only e2e and forced colors. VoiceOver and NVDA testing by hand is still to
  do.
