## MODIFIED Requirements

### Requirement: Single source of truth for display state

The system SHALL compute per-point display state (tier `hidden | faded | base |
selected`, numeric opacity, base opacity, interactivity) in exactly one pure module, and
every consumer (style getters, quadtree construction, hover, click, brush, lasso) SHALL
read that module rather than re-deriving visibility. Category focus (Shift + hover) SHALL
be an input to that module, not a separate opacity path.

#### Scenario: All consumers agree

- **WHEN** any combination of legend-hide, selection, highlight, and category-focus state
  is active
- **THEN** the opacity used for rendering, the points indexed by the quadtree, and the
  points accepted by hover/click/brush/lasso hit-tests are all derived from the same
  model and can never disagree

### Requirement: Selection fading

The system SHALL fade non-selected points only when `selectedProteinIds` is non-empty or
a category focus is active; selected and highlighted points get the selected opacity;
`highlightedProteinIds` alone SHALL never cause fading of other points.

#### Scenario: Highlight without selection

- **WHEN** `highlightedProteinIds` is non-empty, `selectedProteinIds` is empty, and no
  category focus is active
- **THEN** highlighted points get selected opacity and all other points keep base
  opacity (no fading)

#### Scenario: Category focus fades without a selection

- **WHEN** `selectedProteinIds` is empty and a category focus is active
- **THEN** points outside the focused values get faded opacity and points inside them get
  selected opacity

### Requirement: Model freshness without lifecycle coupling

The system SHALL produce a correct model at every call site regardless of Lit lifecycle
state: imperative paths (`isolateSelection`, `resetIsolation`, numeric-rebin callbacks)
and unattached elements (tests calling `_processData`/`_buildStyleGetters` directly)
SHALL observe a model consistent with current inputs. Recomputation SHALL be keyed on
input identity, never on update-cycle execution, and SHALL not run during pan/zoom
reactive churn or during hover churn that leaves the focused values unchanged; a change
of the focused values is an input change and SHALL recompute the model.

#### Scenario: Unattached element computes a model on demand

- **WHEN** a test constructs the element without attaching it and calls
  `_buildStyleGetters()` directly
- **THEN** style getters reflect the element's current filter/hidden/selection inputs

#### Scenario: Hovering within one focused category does not recompute

- **WHEN** a category focus is active and the cursor moves from one point to another
  point whose values yield the same focused value list
- **THEN** the focused values keep the same reference and the model is not recomputed

## ADDED Requirements

### Requirement: Category focus fading tier

The visibility model SHALL accept an optional list of focused internal annotation values
and, when it is non-null, SHALL give selected opacity to every point with at least one
focused value in the selected annotation and faded opacity to every other point, subject
to the precedence below. Focus fading SHALL be an alpha-layer effect: points stay in plot
data and axes do not re-fit. The precedence SHALL be: hidden (opacity exactly `0`) first,
then selected or highlighted (selected opacity), then a non-empty selection (faded
opacity), then focus.

#### Scenario: Multi-label point with one focused value stays in focus

- **WHEN** the focused values are `[A]` and a point has values A and B
- **THEN** the point gets selected opacity

#### Scenario: Point without focused values fades

- **WHEN** the focused values are `[A]` and a point has only value B
- **THEN** the point gets faded opacity and stays interactive under the default
  `fadedOpacity`

#### Scenario: Zero-value point is always out of focus

- **WHEN** a category focus is active and a point has no value in the selected annotation
- **THEN** its base opacity is the faded opacity, never the selected opacity
- **AND** its render opacity stays exactly `0` whenever the vacuous-truth hidden rule
  applies to it

#### Scenario: Focusing N/A

- **WHEN** the focused values contain `__NA__`
- **THEN** points whose value is `null` or the literal `__NA__` get selected opacity

#### Scenario: Hidden points stay hidden under focus

- **WHEN** a category focus is active, a point's values are all hidden via the legend, and
  not all values of the selected annotation are hidden
- **THEN** its opacity is exactly `0` even if one of its values is focused

#### Scenario: Highlighted points keep full opacity

- **WHEN** a category focus is active and a highlighted point has none of the focused
  values
- **THEN** the point gets selected opacity

#### Scenario: Selection outranks focus in the model

- **WHEN** `selectedProteinIds` is non-empty and focused values are also supplied
- **THEN** every non-selected, non-highlighted point gets faded opacity regardless of the
  focused values

#### Scenario: Focus uses the selection draw path

- **WHEN** a category focus is active
- **THEN** the renderer draws in its selection-active mode (out-of-focus points flat
  without density blending, in-focus points blended on top), and depth follows base
  opacity so in-focus points render above out-of-focus points
