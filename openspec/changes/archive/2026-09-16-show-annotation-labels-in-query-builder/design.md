## Context

`annotation-select.ts` (the control bar dropdown) draws each annotation as
`annotationLabel(column, definition)` plus a ⚡ badge when `isPredictedAnnotation(column)`.
`query-condition-row.ts` (one row of the query builder) draws the same annotations as bare column
names, both in its picker list and on the button that shows the condition's current annotation.
The two pickers already share grouping, search (`annotationMatchesQuery`) and flattening through
`annotation-categories.ts`; only the drawing of a name is still written twice, and differently.

The label registry has one collision that matters for display: `cc_subcellular_location`
(UniProt) and `predicted_subcellular_location` (Biocentral) are both "Subcellular location". In the
dropdown the badge and the section header tell them apart.

## Goals / Non-Goals

**Goals:**

- The query builder names every annotation exactly as the dropdown does.
- One renderer for an annotation's name, used by every place that draws one in the control bar.
- A chosen condition stays unambiguous when two annotations share a label.

**Non-Goals:**

- Changing what a condition stores. It keeps the column name; `query-evaluate.ts`, saved settings
  and URLs are untouched.
- Showing the column name next to the label, or highlighting why a row matched. The dropdown does
  neither, and the point here is that the two pickers look alike.
- The EAT and STATS badges and the info popover. They describe the dropdown's colouring and
  statistics features, which the query builder does not offer.
- The legend and projection-metadata panel, which already use `annotationLabel`.

## Decisions

### A shared `renderAnnotationName` template

`control-bar/annotation-name.ts` holds two template functions. `predictedBadge(column)` draws the ⚡
badge with its title and aria-label, or nothing. `renderAnnotationName(column, definition,
labelClass)` draws the label span followed by that badge; `labelClass` is `dropdown-item-label` in a
list row and `dropdown-trigger-text` on a trigger, so the label truncates without taking the badge
with it.

The query builder row, the query builder button and the dropdown trigger call
`renderAnnotationName`. The dropdown row calls `predictedBadge` alone, because its label is followed
by the EAT and STATS badges and the ⚡ badge keeps its place after them.

Alternatives considered:

- **Call `annotationLabel` inline in `query-condition-row.ts`.** Fixes #293 and leaves the badge
  markup, its tooltip text and its accessible name in two copies. That duplication is how the two
  pickers diverged in the first place.
- **A `<protspace-annotation-name>` custom element.** Gives the name its own shadow root, which then
  needs its own copy of the label and badge styles, and adds an element per row to a list that
  re-renders on each keystroke. A template function costs nothing.

### Badge style moves to the shared dropdown mixin

`.predicted-badge` and `.dropdown-item-label` were defined in `annotation-select.styles.ts` only.
Both pickers' stylesheets already compose `dropdownMixin`, so the rules move there and each
component keeps one copy through the mixin.

### Both trigger buttons show the badge too

Without it, choosing either "Subcellular location" produces a button reading exactly the same, in
the query builder and in the dropdown alike. The section headers disambiguate while a list is open;
nothing does once it closes.

### Search matches only the displayed label

`annotationMatchesQuery` becomes a case-insensitive substring test against `annotationLabel`, the
same text the pickers now draw. The column-name word match that `fix-annotation-search-matching`
added earlier on this branch is removed.

That match existed so someone who knows a bundle's column names could type them. It was a fair
trade while the query builder showed column names, but with labels in both pickers it produces
rows the reader cannot account for: `predicted` offers "Membrane", "Signal peptide", "Subcellular
location" and "Transmembrane". The earlier change fixed the worst case, `ted` matching letters
inside `predicted`, and this generalises the same principle to the whole column name.

Alternatives considered:

- **Keep the column-name word match.** Leaves `predicted` → four rows with no visible "predicted".
- **Also match the predicted badge** (so `predicted` finds the ⚡ rows). The badge is an icon with a
  tooltip, not text on the row, and a query matching some rows through an icon and others through
  their label is harder to predict than one matching labels alone.

## Risks / Trade-offs

- [An unregistered column has no nicer name] → It falls back to the prettified column name, the same
  text the dropdown already shows for it, and search reaches it through that label.
- [A reader who types a known column name, such as `predicted_membrane`, finds nothing] → Both
  pickers now show labels only, so the column name is no longer text either picker puts in front
  of the reader; the label ("Membrane") finds it.
- [Existing tests assert on column-name text in the query builder] → Update them to assert labels,
  and keep the `data-annotation` attribute (the column name) for anything that needs the key.
