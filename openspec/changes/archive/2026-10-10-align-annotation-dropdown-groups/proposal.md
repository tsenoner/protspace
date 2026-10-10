## Why

`annotation-presentation` still requires a dedicated "Predicted" group as the first section of the annotation dropdown, with every predicted annotation pulled out of its source group. The code stopped doing that in 8e5d0df7 ("mark de-novo predictions across sources"). The dropdown now groups only by source, and a predicted annotation keeps its source section and carries the ⚡ predicted badge on its row. `annotation-categories.test.ts` pins the current behaviour ("groups Biocentral predictions under their source (not a separate Predicted group)"), so the spec is the stale part. The test-suite audit (#519, slice 19) found the drift.

## What Changes

- Remove the requirement "Dedicated 'Predicted' group in the annotation dropdown".
- Add "The annotation dropdown groups annotations by source": sections Biocentral, InterPro, TED, Taxonomy, UniProt, Other, in that order, with empty sections left out. Annotations are alphabetical within a section, except Taxonomy, which runs from general to specific rank. A predicted annotation stays in its source section and is marked with the predicted badge on its row. Search and keyboard navigation span every section.
- Update the capability's Purpose line to match.

No code changes: this change brings the spec in line with shipped behaviour.

## Capabilities

### Modified Capabilities

- `annotation-presentation`: dropdown grouping is by source, with per-row predicted badges instead of a Predicted group.

## Impact

Spec text only (`openspec/specs/annotation-presentation/spec.md`). The behaviour is already covered by `packages/core/src/components/control-bar/annotation-categories.test.ts` and `annotation-select.component.test.ts`.
