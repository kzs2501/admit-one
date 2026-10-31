# 022: The Regal look

**Status:** Accepted.

## Context

The app used warm cream, a terracotta accent, Inter and Space Grotesk: one of the most
common looks of AI-generated sites, and the same look as its author's portfolio. After
the rename ([021](021-renamed-dress-circle.md)) it needed a look of its own, chosen from
three directions shown on real screens with every text pair measured.

## Decision

**Regal: the Art Deco single-screen cinemas the name comes from.** Mumbai's Regal and Eros
are part of a UNESCO World Heritage site (2018), and a dress circle was their first
balcony.

- **Colour, by role** (`src/app/globals.css`), in OKLCH so equal lightness looks equal:
  terrazzo-grey paper; jade for links, focus and the name; brass for the one primary action
  (`action`); oxblood for the seats you choose (`chosen`); brass, jade and lapis for the
  price tiers on the seat map, dearest first (`tierTones`). Status colours keep their
  meanings and stay apart from the accent.
- **Every pair is measured, both themes,** by `src/app/tokens.test.ts`: WCAG 2.2's ratio
  (4.5:1 for text, 3:1 for a seat's tick and edge) and APCA's Lc (75 for running text, 60
  for labels, links, status and text on fills). APCA is the stricter judge in dark themes:
  it is why the dark greys are lighter than WCAG alone would ask.
- **Type:** Josefin Sans (a 1920s geometric face) for headings, set in capitals as on a
  marquee; Limelight for the name only; Mukta, from Ek Type in Mumbai, for text and prices,
  with tabular figures; Space Mono for codes, not preloaded. Latin files only: Mukta keeps
  ₹ in a 60 KB Devanagari file, so the device's own font draws the rupee, as it did before.
  About 68 KB of type is preloaded, as before.
- **Shape:** square corners (2 px), a double brass rule under the header, and double-ruled
  tickets and order summaries, like a printed stub. Pills stay round.

## Consequences

- The portfolio gets a different look of its own, so the two never read as one template.
- Contrast is a test, not a review step: a token change that loses it fails before any
  screenshot does.
- The installable app's icons are drawn from `src/app/icon.svg` by `scripts/icons.mjs`, and
  the share card (`src/app/opengraph-image.tsx`) uses the same fonts, committed as TTF with
  their SIL Open Font License texts.
