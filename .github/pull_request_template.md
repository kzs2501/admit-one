## What and why

<!-- What changes, and why. Link the issue or decision record, if there is one. -->

## How it was checked

<!-- The tests added or run. For a bug fix: the new test, failing without the fix. -->

## Review checklist

From [CONTRIBUTING.md](../CONTRIBUTING.md#review-checklist):

- [ ] **Design** — in the right layer, and the dependency rule still holds
- [ ] **Functionality** — handles failure too: decline, timeout, expiry, a duplicate webhook
- [ ] **Complexity** — as simple as it can be; state is a union, not a set of flags
- [ ] **Tests** — they would fail if the code were broken
- [ ] **Naming** — units and boolean prefixes; no ambiguous abbreviations
- [ ] **Accessibility** — keyboard, focus, labels, announcements, contrast in both themes
- [ ] **Docs** — comments say why; a decision record if a decision was made
