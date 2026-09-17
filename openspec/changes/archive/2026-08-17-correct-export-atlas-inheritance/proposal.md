## Why

`defer-label-atlas-allocation` gave "the live renderer has no label atlas" a second cause, and the
export path was not told.

Before it, the state had exactly one cause: the device could not hold an atlas, so the live view was
rendering dominant colours and an export that did the same matched the screen. The scenario in
`renderer-capability-limits` says so — _"WHEN the live renderer has no label atlas THEN the export
allocates none either and renders dominant colours"_ — and while that was the only cause, the
condition determined the outcome.

Releasing the atlas for a single-label annotation added a second cause with the opposite correct
answer. `this.atlas` records only what the last completed render staged, and nothing forces a render
before an export, so it is now null in situations where the export **should** allocate — before the
first populate, on an empty render, and in the window between an annotation switch and the next
frame. It is equally non-null in the mirror window, after a switch to a single-label annotation,
where the export should allocate nothing.

The code was corrected in the same PR (`exportLabelStride`). This change corrects the spec, which
still describes the pre-#457 world and would lead the next reader to reintroduce the defect.

## What Changes

- **The WANT question moves to the styling authority.** Whether an atlas is wanted at all is asked
  of the same style getters the export stages its colours through, so the atlas decision and the
  colour decision cannot disagree. This is a spec correction only; the code already does it.
- **The existing scenario is narrowed to its real condition.** "The live view has no atlas" becomes
  "the device cannot hold one", which is the case it was written for and where it still holds.
- **The two new cases are stated.** A single-value annotation exports no atlas even if the renderer
  still holds one from an earlier annotation; a multi-value annotation exports one even if no frame
  has been staged yet.

## Capabilities

### Modified Capabilities

- `renderer-capability-limits`: the export's atlas decision is sourced from the live styling
  authority rather than from the live renderer's current allocation, and the "no atlas" scenario is
  narrowed to the device-limit case it was written for.

## Impact

- `openspec/specs/renderer-capability-limits/spec.md` — one requirement's scenarios.
- No code change. `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts`
  (`exportLabelStride`) and its two tests in `webgl-renderer.export-transform.test.ts` already
  implement and pin this; they shipped in the same PR that made the spec stale.
- No user-visible change beyond the one already shipped: a figure exported in the window after an
  annotation switch shows pie markers rather than dominant colours.

## Depends On

`defer-label-atlas-allocation` (#457), which introduced the second cause this change describes.
