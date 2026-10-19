# 015 — Reporting at scale: generated history, keyset pages, live updates, a table that stays a table

**Status:** Accepted

## Context

An organiser's dashboard has to show thousands of orders and live numbers, in a
sandbox that lives in one browser tab. That raised four questions:

- where the data comes from;
- how to page through it without errors;
- how to keep it current;
- how to show 9,000 rows to everyone, including keyboard and screen-reader users.

## Decision

**The data**

- **History is generated, not stored.** About 9,000 orders from the 30 days before
  the sandbox started come from a seed, like the concert hall's sold seats. That many
  orders would overflow the sandbox's storage and slow every save.
  - The history agrees with the catalogue: fulfilled tickets add up to each tier's
    baseline, and seated orders take the hall's sold seats.
  - It's generated on the first organiser request, in about 25 ms.
  - Only what changes is stored: the sandbox's own orders, other buyers' sales (a
    sequence number each, from which the rest is derived) and refunds.

**The API**

- **Filtering, sorting and search happen on the server.**
- **Paging is by keyset (AIP-158).** An opaque page token holds the last row's sort
  key and id, and the next page starts after it.
  - Unlike offsets, new orders arriving between pages can't repeat or skip a row.
  - A token used with other filters is refused rather than quietly wrong.
- **Sorting follows AIP-132** (`orderBy=totalMinor desc`), with the id breaking ties.
- **Days are calendar days in the organisation's time zone.**
- **Metrics.** Tickets sold come from the inventory, so they agree with the event
  page's "left". Money and days come from the orders, and webhook lag is reported at
  p50 and p95 by nearest rank.
- **CSV export:**
  - RFC 4180, with a UTF-8 BOM for Excel;
  - text that buyers typed is guarded against formula injection (OWASP, "CSV
    Injection"), while numbers are left as numbers.

**Live updates**

- **Server-sent events, read with `fetch`.** `EventSource` can't send an
  `Authorization` header, and a token in the URL leaks into logs. So the stream is an
  authenticated `text/event-stream` response like any other.
  - It names the account's events whose orders changed, only theirs, gathered for a
    quarter of a second.
  - A comment every 15 s keeps idle connections open.
- **Events invalidate; they don't carry data** (TkDodo, "Using WebSockets with React
  Query"). The dashboard re-reads what's on screen, at most once a second.
- **Recovering from a dropped stream:**
  - reconnects back off with full jitter (AWS, "Exponential Backoff and Jitter"), from
    1 to 30 s;
  - every reopening catches up on everything, after a drop or a pause;
  - while the stream is down, the page polls every 15 s.
- **Updates can be paused** (WCAG 2.2.2): stream and polling both stop.
- **The table never moves under the reader.** It offers to show the latest rows
  instead.

**The table**

- **A real `<table>`, virtualised.** TanStack Virtual draws only the rows in view;
  spacer rows hold the rest of the height. Rows aren't positioned absolutely, because
  changing a table's display strips its semantics in some browsers (Adrian Roselli,
  "Tables, CSS Display Properties, and ARIA").
- **What it tells assistive tech:**
  - `aria-rowcount` is the whole count, and each row's `aria-rowindex` says where it
    sits.
  - A focused row stays drawn when it scrolls out of view.
  - Sortable headers are buttons, with `aria-sort` on the sorted one (APG sortable
    table).
- **Columns come from TanStack Table v9** (`useTable`, features declared explicitly).
  Both libraries load only on the organiser's pages.
- **Filters live in the URL:** shareable, kept by a reload, undone by Back. Typing
  replaces the URL entry rather than pushing a new one.
  - The filters are optimistic (`useOptimistic`), because Next changes the URL in a
    transition: a checkbox bound to it would otherwise snap back until navigation
    finished.

**Charts**

- **Sales by day** is an SVG named by a written summary, with every number in a table
  one click away (W3C WAI, "Complex images").
- **The funnel and payment mix** are lists whose bars are decoration.
- **Ticket types** are native `<meter>`s.

## Consequences

- Nine thousand rows stay fast: about 30 in the DOM, and filtering and sorting take
  well under 200 ms of interaction time with the CPU slowed four times (an e2e budget).
- The numbers on every screen agree, because they come from one set of rows and one
  inventory.
- **The sandbox's limits:**
  - The history is the same for everyone and fixed in shape; only what happens in the
    sandbox changes it.
  - Every query works through the rows in memory, which is fine at this size. A real
    service would query a database with indexes on the sort keys.
- **Out of scope:** saved views, column choice and ordering, server-sent data rather
  than invalidations, and reports over years rather than weeks.
