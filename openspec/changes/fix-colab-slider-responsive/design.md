## Context

The Generate cell renders each dimensionality-reduction parameter group as an `ipywidgets.VBox` inside a wrapping `HBox`. Each group currently declares `flex: 1 1 220px`, while a rendered slider's description, value readout, and internal spacing consume about 228 px before any track length is available. With UMAP and t-SNE enabled, three groups therefore remain on one row at widths where their tracks collapse to nearly zero.

The layout lives inside the committed notebook JSON, and the fix must work in Colab without adding new CSS, JavaScript, or dependencies.

## Goals / Non-Goals

**Goals:**

- Wrap parameter groups before their slider tracks become unusable.
- Preserve the existing controls, values, callbacks, and ordinary desktop layout.
- Add a focused automated guard and repeatable rendered-browser verification.

**Non-Goals:**

- Redesigning other notebook sections or controls.
- Changing dimensionality-reduction defaults or processing behavior.
- Adding a general notebook testing framework or external dependency.

## Decisions

1. Increase the parameter-group flex basis from 220 px to 300 px. Rendered measurements show a consistent 228 px card-to-track difference (for example, a 345 px card has a 117 px track), so a 300 px card preserves roughly 72 px of track before the flex container wraps. A larger basis would wrap earlier but consume unnecessary vertical space; changing slider label widths would alter the established alignment and would not address every label/readout combination.
2. Set the parameter-group minimum width to the same 300 px reserve. `flex-basis` is only a preferred size while `flex-shrink: 1`; without an explicit floor, a lone card can still shrink below the responsive reserve. The parent `HBox` already uses ipywidgets' scrolling box behavior, so narrower panes can scroll to the full-width control instead of clipping a collapsed track.
3. Keep `flex-flow: row wrap` and the existing card-level `overflow: hidden`. Wrapping is already the intended responsive mechanism, and the explicit minimum width removes the residual shrink path without adding breakpoint CSS to the notebook.
4. Guard the responsive contract with a focused Python test that executes the committed notebook cell and asserts both the 300 px flex basis and its matching minimum-width floor. Rendered browser verification at desktop and compressed widths supplies the end-to-end evidence that the structural contract produces usable tracks.

## Risks / Trade-offs

- [Risk] Two cards may wrap sooner in unusually narrow notebook panes. → This is the intended trade-off: added vertical space preserves accurate slider interaction.
- [Risk] A pane narrower than one parameter group needs horizontal scrolling. → Preserve the 300 px control width and rely on the parent ipywidgets box's existing overflow behavior rather than collapsing the slider.
- [Risk] Widget implementations can change their fixed internal chrome. → Keep a margin above the measured 228 px and verify actual track geometry in a real browser.
- [Risk] Notebook editors can reserialize unrelated JSON. → Make the source edit surgically and review the notebook diff before committing.

## Migration Plan

No migration is required. The notebook-only layout value is applied the next time the Generate cell runs; reverting the one-line basis change restores the previous behavior.

## Open Questions

None.
