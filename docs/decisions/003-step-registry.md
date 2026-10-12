# 003 — A typed step registry, driven by the URL

**Decision.** Checkout steps live in one registry (`src/checkout/registry.ts`). Each
step declares `isApplicable(ctx)` and `isComplete(ctx)`. The flow is whatever applies;
the URL (`/checkout/[holdId]/[step]`) says where the buyer is; `resolveStep` decides
whether they're allowed to be there.

**Why.**
- Navigation, progress, guards and focus handling are written once, against the list,
  and no step knows about any other. The extras step simply doesn't exist for events
  without extras.
- The URL is the source of truth, so refresh resumes in place, back/forward work, and
  a deep link can't skip ahead: an unmet step redirects to the first incomplete one.
- Drafts live in sessionStorage per hold, validated on read, so typed details survive
  reloads and carry over to a re-reserved hold.

**Two details worth knowing.**
- *Review is complete only if the server's order matches the draft.* Editing attendees
  after creating the order sends you back through review, so you can never pay for
  stale details.
- *The flow lives in the `[holdId]` layout, not the `[step]` page.* Changing a dynamic
  segment remounts the page, which reset the "previous step" and broke focus moving to
  each new heading. A layout persists across step changes. The browser tests caught
  this.
