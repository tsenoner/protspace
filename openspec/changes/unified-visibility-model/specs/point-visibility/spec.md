# Spec delta: point-visibility (unified-visibility-model)

This change introduces the `point-visibility` capability spec. The requirements below
pin behavior that already exists in the implementation; the change makes a single pure
module (`visibility-model.ts`) the sole authority for them.

## ADDED Requirements

### Requirement: Single source of truth for display state

The system SHALL compute per-point display state (tier `hidden | faded | base |
selected`, numeric opacity, base opacity, interactivity) in exactly one pure module, and
every consumer (style getters, quadtree construction, hover, click, brush, lasso) SHALL
read that module rather than re-deriving visibility.

#### Scenario: All consumers agree

- **WHEN** any combination of legend-hide, selection, and highlight state is active
- **THEN** the opacity used for rendering, the points indexed by the quadtree, and the
  points accepted by hover/click/brush/lasso hit-tests are all derived from the same
  model and can never disagree

### Requirement: Two enforcement layers stay distinct

The system SHALL keep query-filter and isolation as physical culling (points removed
from plot data, scale domains shrink, axes re-fit) and SHALL keep legend-hide and
selection fading as alpha-layer effects (points remain in plot data and GPU buffers,
axes do not re-fit).

#### Scenario: Hiding a legend value does not re-fit axes

- **WHEN** the user hides an annotation value via the legend
- **THEN** scale domains and axis extents are unchanged, and the hidden points remain in
  the plot data with opacity 0

#### Scenario: Applying a query filter re-fits axes

- **WHEN** a query filter is applied via `filteredProteinIds`/`filtersActive`
- **THEN** non-matching points are physically removed from the plot data and scale
  domains are recomputed from the remaining points

#### Scenario: Filters-off versus zero-match filter

- **WHEN** `filtersActive` is false
- **THEN** no cull mask is applied (distinct from `filtersActive` true with an empty
  `filteredProteinIds`, which yields an intentionally blank plot)

### Requirement: Hidden points have exactly zero opacity

The system SHALL assign opacity exactly `0` (not merely a small value) to
annotation-hidden points: consumers gate with a mix of comparisons (`=== 0` at export
culling and hover/click, `> 0` at tracking and the quadtree, `< 0.001` at the shader
discard) that agree on "invisible and non-interactive" only at exactly `0`.

#### Scenario: Hidden value yields exact zero

- **WHEN** every annotation value of a point is in the hidden set (after normalization)
  and not all values of the selected annotation are hidden
- **THEN** the model's opacity for that point is exactly `0`

### Requirement: Hidden beats selection

The system SHALL apply the hidden rule before selection/highlight opacity: a hidden
point has opacity `0` even when it is selected or highlighted.

#### Scenario: Selected point in hidden category

- **WHEN** a selected protein's only annotation value is hidden
- **THEN** its opacity is `0` and it is not interactive

### Requirement: Multilabel hidden rule

The system SHALL hide a multi-value point only when **every** one of its annotation
values is hidden; partially hidden points stay visible (their colors drop only the
hidden values' entries).

#### Scenario: Partially hidden multilabel point

- **WHEN** a point has values A and B and only A is hidden
- **THEN** the point remains visible with B's color only

#### Scenario: Vacuous truth for zero-value points

- **WHEN** a point has zero annotation values (Int32Array sentinel), an annotation is
  selected, and not all values are hidden
- **THEN** the point is hidden — even if the hidden set is empty

### Requirement: All-hidden escape hatch

The system SHALL ignore the hidden filter for opacity when every value of the selected
annotation is hidden (so the plot never blanks from legend interaction), while colors
are NOT rescued (points render the renderer's fallback grey).

#### Scenario: Hiding the last visible value

- **WHEN** the hidden set comes to cover every value of the selected annotation
- **THEN** all points render with their base/selection-tier opacity and fallback color

### Requirement: Value normalization

The system SHALL compare annotation values as internal keys: `toInternalValue` is
applied to both the point's values and the hidden list, `null` maps to `__NA__`, and a
literal `__NA__` string passes through unchanged.

#### Scenario: Null and literal NA behave identically

- **WHEN** `__NA__` is in the hidden set
- **THEN** points whose value is `null` and points whose value is the literal string
  `__NA__` are both hidden

### Requirement: Selection fading

The system SHALL fade non-selected points only when `selectedProteinIds` is non-empty;
selected and highlighted points get the selected opacity; `highlightedProteinIds` alone
SHALL never cause fading of other points.

#### Scenario: Highlight without selection

- **WHEN** `highlightedProteinIds` is non-empty and `selectedProteinIds` is empty
- **THEN** highlighted points get selected opacity and all other points keep base
  opacity (no fading)

### Requirement: Interactivity is numeric opacity, evaluated at event time

The system SHALL define interactivity as `opacity > 0` using the configured opacity
values (a `fadedOpacity` of `0` makes faded points non-interactive), and SHALL evaluate
it against current inputs at event time so hit-testing is correct even while the
quadtree rebuild is rAF-deferred. The renderer-capacity gate (`isPointRendered`) remains
a separate check outside the model.

#### Scenario: Faded points are clickable under default config

- **WHEN** a selection is active and `fadedOpacity` is the default `0.15`
- **THEN** faded points respond to hover, click, brush, and lasso

#### Scenario: Hidden points are not clickable

- **WHEN** a point's opacity is `0`
- **THEN** it is excluded from the quadtree and rejected by hover/click/brush/lasso even
  during the one-frame quadtree staleness window

### Requirement: Depth is independent of hidden state

The system SHALL derive render depth from base (selection-tier) opacity only, so
toggling hidden values never changes depth sort order and the renderer's color-only fast
path is preserved.

#### Scenario: Hide/unhide keeps depth byte-identical

- **WHEN** an annotation value is hidden and then un-hidden
- **THEN** every point's depth value is identical before and after (within 1e-6)

### Requirement: Model freshness without lifecycle coupling

The system SHALL produce a correct model at every call site regardless of Lit lifecycle
state: imperative paths (`isolateSelection`, `resetIsolation`, numeric-rebin callbacks)
and unattached elements (tests calling `_processData`/`_buildStyleGetters` directly)
SHALL observe a model consistent with current inputs. Recomputation SHALL be keyed on
input identity, never on update-cycle execution, and SHALL not run during pan/zoom/hover
reactive churn.

#### Scenario: Unattached element computes a model on demand

- **WHEN** a test constructs the element without attaching it and calls
  `_buildStyleGetters()` directly
- **THEN** style getters reflect the element's current filter/hidden/selection inputs
