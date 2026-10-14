# 003 — A typed step registry, driven by the URL

**Status:** Accepted

## Context

Checkouts grow steps conditionally — extras only for some events, payment only once an
order exists — and the classic failure is navigation logic smeared across every step,
plus a URL that doesn't say where the buyer is (so refresh and back break).

## Decision

The steps live in one registry (`features/checkout/domain/step-registry.ts`). Each
declares `isApplicable(context)` and `isComplete(context)`; the flow is whatever
applies. The URL (`/checkout/[holdId]/[step]`) says where the buyer wants to be, and
`resolveStep` decides whether they may be there or should be redirected to the first
incomplete step. `useCheckout` turns all of this into one `CheckoutState` for the UI.

## Consequences

- Navigation, progress, guards and focus are written once, against the list; no step
  knows about another, and the extras step simply doesn't exist for events without
  extras.
- Refresh resumes in place, back and forward work, and a deep link can't skip ahead.
- Drafts live in sessionStorage per hold, parsed on read, so typed details survive a
  reload and carry over to a re-reserved hold.
- Review counts as complete only if the server's order matches the draft, so editing
  attendees after creating the order sends the buyer back through review — they can
  never pay for stale details.
- The flow lives in the `[holdId]` layout, not the `[step]` page: changing a dynamic
  segment remounts a page, which broke focus moving to each new heading. A layout
  persists across steps. The browser tests caught this.
