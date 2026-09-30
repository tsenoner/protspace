# category-focus Specification

## Purpose

The Shift + hover gesture on the scatterplot that shows where one category sits in the embedding: every point sharing the hovered point's value in the selected annotation stays in focus while the rest fade, without touching the legend, the selection or the URL state. It covers when focus starts and ends, how the Other bucket, N/A and hidden values behave, and how a selection takes precedence.

## Requirements

### Requirement: Shift + hover focuses the hovered point's category

The scatterplot SHALL start a category focus when the cursor is on an interactive point
while Shift is held, an annotation is selected and no protein is selected, using the
hovered point's internal values in the selected annotation (read from the materialized
data, so numeric bins and EAT predictions apply) as the focused values. Focus SHALL be
purely visual: it SHALL NOT change the selection, legend-hidden values, highlights or URL
state, and SHALL NOT change click, brush or lasso handling beyond the interactivity its
faded opacity implies (none under the default `fadedOpacity`).

#### Scenario: Pressing Shift over a still cursor

- **WHEN** the cursor rests on a point whose only value A is outside the Other bucket and
  the user presses Shift
- **THEN** focus starts immediately with focused values `[A]`, without waiting for a
  mouse move

#### Scenario: Moving onto a point with Shift held

- **WHEN** the user holds Shift and moves the cursor onto a point whose only value B is
  outside the Other bucket
- **THEN** focus starts (or switches) to focused values `[B]`

#### Scenario: Multi-label point

- **WHEN** Shift + hover lands on a point with values A and B, neither in the Other bucket
- **THEN** the focused values are `[A, B]`, so every point with A or B stays in focus

#### Scenario: Focusing an N/A point

- **WHEN** Shift + hover lands on a point whose value is N/A
- **THEN** the N/A category is focused and every other N/A point stays in focus

#### Scenario: Point without a value

- **WHEN** Shift + hover lands on a point that has no value in the selected annotation, or
  no annotation is selected
- **THEN** no focus starts

#### Scenario: Hidden categories stay hidden

- **WHEN** focus is active and some legend values are hidden
- **THEN** points whose values are all hidden stay invisible and non-interactive, as
  without focus

### Requirement: The Other bucket focuses as one category

The focused values SHALL be the hovered point's values plus every Other-bucket value
(`otherAnnotationValues`) whenever any of the hovered point's values belongs to the
legend's Other bucket, so the focus matches the group the legend shows.

#### Scenario: Hovering an Other point

- **WHEN** the Other bucket holds values X, Y and Z and Shift + hover lands on a point with
  value X
- **THEN** every point with X, Y or Z stays in focus and all other points fade

### Requirement: A selection outranks focus

The scatterplot SHALL NOT start a category focus while `selectedProteinIds` is non-empty,
and SHALL end an active focus when a selection becomes non-empty.

#### Scenario: Shift + hover with a selection

- **WHEN** proteins are selected and the user Shift + hovers a point
- **THEN** no focus starts and the selection fading is unchanged

#### Scenario: Selecting while focused

- **WHEN** focus is active and the selection becomes non-empty
- **THEN** focus ends in the same update and only the selection fading is shown

### Requirement: The protein tooltip is hidden while focused

The scatterplot SHALL hide the protein tooltip while a category focus is active and
SHALL show it again when focus ends with the cursor still on a point. `protein-hover`
events SHALL still be dispatched while focused.

#### Scenario: Tooltip during focus

- **WHEN** the cursor is on a point and the user presses Shift, starting a focus
- **THEN** the tooltip is no longer visible

#### Scenario: Tooltip after releasing Shift

- **WHEN** focus ends because Shift is released while the cursor stays on the point
- **THEN** the tooltip for that point is visible again

### Requirement: Focus ends when its trigger goes away

The scatterplot SHALL end an active category focus when Shift is released, when the
window loses focus, when the cursor leaves the point (onto empty background or out of
the canvas), when a selection becomes non-empty, when the plot data is replaced, and
when the element is disconnected.

#### Scenario: Releasing Shift

- **WHEN** focus is active and the user releases Shift
- **THEN** focus ends and all points return to their normal opacity

#### Scenario: Window blur

- **WHEN** focus is active and the browser window loses focus (for example via
  Cmd/Alt + Tab)
- **THEN** focus ends and the Shift state is cleared

#### Scenario: Leaving the point or the canvas

- **WHEN** focus is active and the cursor moves onto empty background or out of the canvas
- **THEN** focus ends

#### Scenario: Data swap

- **WHEN** focus is active and the scatterplot's `data` is replaced
- **THEN** the hovered point is dropped and focus ends in the same update

### Requirement: Focus is re-derived when its inputs change under a still cursor

The scatterplot SHALL re-derive an active focus from the still hovered point before the
update renders whenever the selected annotation, the Other bucket, numeric binning
settings or the EAT overlay change, so no frame shows the previous inputs' focus.

#### Scenario: Switching annotation while focused

- **WHEN** focus is active on a point and the selected annotation changes to one where the
  same point has value C
- **THEN** the first render with the new annotation already focuses `[C]`

#### Scenario: New annotation has no value for the point

- **WHEN** focus is active and the selected annotation changes to one where the hovered
  point has no value
- **THEN** focus ends in that same update

### Requirement: Shift pressed in a text field does not start focus

The scatterplot SHALL NOT start a category focus from a Shift `keydown` whose target is
inside an `input`, a `textarea` or a `[contenteditable="true"]` element.

#### Scenario: Typing a capital letter in the search box

- **WHEN** the cursor rests on a point and the user presses Shift while typing in a text
  input
- **THEN** no focus starts and the plot does not change

#### Scenario: Moving the mouse with Shift held after typing

- **WHEN** Shift is held after a keydown in a text input and the user then moves the cursor
  over a point on the canvas
- **THEN** focus starts, because the mouse event reports Shift as held

### Requirement: Mouse movement resyncs the Shift state

On every canvas mousemove the scatterplot SHALL set its Shift state from the event's
`shiftKey` flag, so a Shift `keyup` that never reached the page cannot leave focus stuck
on.

#### Scenario: Lost keyup

- **WHEN** focus is active, Shift is released while the `keyup` is not delivered to the
  page, and the user then moves the mouse over the plot
- **THEN** the next hover sees Shift as released and focus ends

### Requirement: Focus changes are bounded to category changes

The scatterplot SHALL update its focused values only when the new list differs in content
from the current one, so hovering between points that yield the same focused values
schedules no update and no visibility recomputation, and SHALL skip the focus lookup
entirely on hovers without Shift. An update that changes only the focus (for example
pressing or releasing Shift over a still cursor) SHALL redraw the plot once, not twice.

#### Scenario: Moving within a category

- **WHEN** focus is active on value A and the cursor moves to another point whose only value
  is A
- **THEN** the focused values are not reassigned and no recomputation runs

### Requirement: The Tips popover lists Shift + Hover

The scatterplot's Tips & Shortcuts popover SHALL list a `Shift + Hover` row in its
Interaction section, directly after the `Hover` row, described as "Focus the point's
category".

#### Scenario: Opening the Tips popover

- **WHEN** the user opens the Tips popover
- **THEN** the Interaction section shows `Shift` + `Hover` with "Focus the point's
  category"
