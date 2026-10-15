## Why

The control bar's annotation dropdown names an annotation by its label — "CATH-Gene3D",
"SUPERFAMILY", "EC number" — but the query builder's annotation picker, and the button that shows
a condition's chosen annotation, print the raw column name: `cath`, `superfamily`, `ec` (#293). A
reader who picks "CATH-Gene3D" to colour by and then opens the filter has to recognise it again
under a different name.

It is also why the query builder's search looks broken. Both pickers already match the label, so
typing `gene` in the query builder offers a row that reads only `cath`, and typing `ted` hides rows
that visibly read `predicted_membrane`. The match is right; the picker is drawing the wrong text.

Search has the mirror problem wherever labels are shown: it still matches a word of the column
name, so typing `predicted` in the dropdown offers four rows reading "Membrane", "Signal peptide",
"Subcellular location" and "Transmembrane", none of which says "predicted". Once both pickers draw
labels, matching anything but the label is matching text the reader cannot see.

## What Changes

- The query builder's annotation picker lists each annotation under its label, with the same ⚡
  badge the dropdown gives a predicted annotation.
- The condition row's annotation button shows the chosen annotation's label and badge, not its
  column name. The control bar dropdown's own button gains the same badge, so a chosen predicted
  annotation is told apart from a curated one of the same label there too.
- Conditions still store, evaluate and persist the raw column name. Only what is drawn changes.
- One shared renderer draws an annotation's name in the dropdown, the query builder picker and the
  condition button, so the three cannot drift apart again.
- Search matches only the displayed label, as a case-insensitive substring. The column-name word
  match is removed, so `predicted` no longer offers the Biocentral rows. A column with no registry
  entry is labelled by its prettified name and stays findable through it: `my_custom_score` is
  offered for `core`, because the reader is looking at "My custom score".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `annotation-presentation`: friendly labels are required in the query builder's annotation picker
  and condition button, not only in the dropdown and legend header; search matches only the
  displayed label, and the requirement is renamed to say so.

## Impact

- `packages/core/src/components/control-bar/query-condition-row.ts`: picker rows and trigger render
  the label.
- `packages/core/src/components/control-bar/annotation-select.ts`: draws its trigger and its row
  badge through the shared renderer.
- `packages/core/src/components/control-bar/annotation-name.ts` (new), and the label and badge
  styles moved into `dropdownMixin` where both pickers' stylesheets reach them.
- `packages/utils/src/visualization/annotation-metadata.ts`: `annotationMatchesQuery` drops the
  column-name word match.
- `apps/web/tests/numeric-binning.spec.ts` finds query builder rows by column name rather than by
  their visible text.
- No change to conditions, query evaluation, stored settings, URLs or exports.
