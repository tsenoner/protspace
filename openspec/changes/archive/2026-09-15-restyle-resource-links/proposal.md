## Why

Adding TED made three problems in the structure viewer header visible at once.

The resource links render at `0.75rem` in `--text-secondary` — the same treatment as the
`.protein-id` sitting immediately beside them — so they read as metadata rather than as
things you can press, and nothing marks them as leaving the application. AlphaFold is worse
off: it is not in that row at all, it is the header's `<h*>`-styled title, so the one
destination the viewer is actually named after is a link almost nobody discovers.

Meanwhile `.header-links` is a non-wrapping flex row inside a wrapping parent, so every
resource added makes the group monolithically wider, and each one is hand-written as an
eight-line anchor preceded by a manually placed `&middot;` separator. `add-ted-link`
considered folding those into a descriptor list and deferred it as scope creep, which was
the right call for one link. It is not the right call for a row that now has to gain an
affordance, a separator rule, and a fourth entry.

## What Changes

- Move the external-resource links onto their own row beneath the title, so the row can wrap
  and the title carries no hidden navigation.
- Render AlphaFold as a peer of UniProt, InterPro, and TED rather than as the header title.
- Mark every resource link as leaving the application with a shared external-link indicator.
- Define the row once, as an ordered descriptor list beside the URL builders, and let CSS own
  the separators instead of hand-placed `&middot;` elements.

## Capabilities

### Modified Capabilities

- `protein-resource-links`: the set of destinations becomes an ordered, data-driven row that
  includes AlphaFold, and every entry carries the same external-link affordance.

## Impact

- Affects the structure viewer header template and styles in `packages/core`.
- Extends the existing header-link Vitest coverage to the full row rather than a single anchor.
- Updates the Explore documentation and regenerates the structure-viewer screenshot.
- Adds no dependencies, no network requests, and no API changes. Every destination URL is
  byte-for-byte what it was; only placement, affordance, and definition change.
