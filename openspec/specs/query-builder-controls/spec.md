# query-builder-controls Specification

## Purpose

How the query builder's controls behave as controls rather than as filters: how they reach the design system instead of restating it, how the two searchable pickers are driven from the keyboard and announced to assistive technology, and the stylesheet-ordering constraint that composing a shared sheet imposes on the components that adopt it. What those controls _mean_ — what a condition matches — is `filter-query-semantics`.

## Requirements

### Requirement: Query builder controls carry the design system's focus indicator

Every interactive control in the query builder SHALL show the design system's focus indicator rather
than the browser's default. The query builder's stylesheet SHALL compose the design system — the
token sheet plus the button, input and dropdown mixins — instead of restating their declarations,
because the row and picker components have their own shadow roots and inherit custom properties but
not component classes from the control bar around them. Where a mixin's element selectors cannot
reach a control, the markup SHALL adopt the mixin's provided class hook rather than the sheet
growing a local mirror of the mixin's rules.

#### Scenario: Focusing the comparison operator

- **WHEN** a user tabs to the numeric comparison operator control
- **THEN** it shows the design system's focus ring
- **AND** not the browser's default focus ring, which follows the operating system accent colour and
  can render as an unrelated colour

#### Scenario: A control the mixin's element selectors miss

- **WHEN** a control is outside a mixin's element selectors, such as a number input
- **THEN** it carries the mixin's class hook and picks the rules up that way
- **AND** the stylesheet keeps only the declarations that are genuinely local to that control

#### Scenario: Picker rendered outside the control bar's shadow root

- **WHEN** a picker component renders in its own shadow root
- **THEN** its controls are styled identically to the same controls elsewhere in the app

### Requirement: The picker option lists are navigable by keyboard

Both query builder pickers SHALL support the same keyboard contract as the app's other searchable
dropdowns: `ArrowDown` and `ArrowUp` walk the filtered list and SHALL clamp at each end rather than
wrapping, `Enter` commits the current row, and `Escape` closes the dropdown. `Escape` SHALL NOT also
close the surrounding modal. Opening a closed picker from its trigger SHALL be possible with `Enter`
or `Space`. This contract SHALL be stated once and shared by every component that implements a
searchable listbox, so the keyboard does not behave differently from one dropdown to the next.

#### Scenario: Walking the list

- **WHEN** the picker is open and the user presses ArrowDown repeatedly
- **THEN** the highlight advances one row at a time through the filtered list
- **AND** stops on the last row rather than wrapping to the first

#### Scenario: Escape inside a modal

- **WHEN** the user presses Escape with a picker open inside the query builder modal
- **THEN** the picker closes
- **AND** the modal stays open

#### Scenario: Opening from the trigger

- **WHEN** the trigger has keyboard focus and the user presses Enter or Space
- **THEN** the picker opens
- **AND** does not immediately toggle back shut from the same keypress

#### Scenario: A locked-out list

- **WHEN** every entry is locked out because the exclusive "Any value" sentinel is selected
- **THEN** the arrows do not move the highlight and Enter commits nothing, matching the pointer

### Requirement: Pointer hover does not move the keyboard cursor

Hovering a row SHALL NOT write the keyboard highlight. Hover feedback SHALL come from CSS, which
renders it identically to the keyboard highlight, so the two can point at different rows without
looking different. Because they can differ, `Enter` SHALL commit the hovered row when the pointer is
over one, and the highlighted row otherwise — including when no arrow key has been pressed and there
is no highlight at all.

#### Scenario: Dragging the pointer down a long list

- **WHEN** the pointer crosses many rows of an option list
- **THEN** no component state changes and no re-render is scheduled per row
- **AND** each row still shows hover feedback

#### Scenario: Pointer and keyboard disagree

- **WHEN** the keyboard cursor is on one row and the pointer rests on another, and Enter is pressed
- **THEN** the hovered row is committed

#### Scenario: Enter with a pointer but no keyboard cursor

- **WHEN** the user has pressed no arrow key and presses Enter while hovering a row
- **THEN** that row is committed

### Requirement: The stored highlight is clamped against the list it indexes

The highlight index SHALL be clamped against the current list every time it is used, for both
navigation and rendering. The list can shrink underneath a stored index — a search narrows it, a
selection removes the chosen value from a picker that stays open for multi-add, and a dataset change
replaces it wholesale — and an index past the end SHALL NOT leave `aria-activedescendant` pointing
at an element that is no longer rendered.

#### Scenario: Selecting the last entry of a multi-add picker

- **WHEN** the user highlights the last value, presses Enter, and the picker stays open with that
  value now removed from the list
- **THEN** `aria-activedescendant` does not reference a missing element
- **AND** the next ArrowUp moves relative to the shortened list rather than skipping a row

#### Scenario: The underlying data changes while a picker is open

- **WHEN** the available annotations are replaced while the picker is open and the highlight sits
  past the end of the new list
- **THEN** no row claims to be highlighted and Enter is not silently inert against a stale index

### Requirement: The pickers are announced as listboxes

Each picker SHALL expose its option list as a listbox to assistive technology: `role="listbox"` on
the element that contains the options, `role="option"` on each entry, and `aria-activedescendant` on
the focused search input tracking the keyboard cursor. The listbox role SHALL sit on the option
container rather than the popover, because the popover also contains the search input and a textbox
is not a valid listbox child. The search input SHALL carry `role="combobox"` with `aria-expanded`
and `aria-controls`, since `aria-activedescendant` on a bare textbox is poorly announced, and SHALL
have an accessible name. A trigger that opens a picker SHALL carry `aria-expanded` and
`aria-haspopup="listbox"`. When nothing is highlighted, `aria-activedescendant` SHALL be absent
rather than empty.

#### Scenario: Nothing highlighted yet

- **WHEN** a picker has just opened and no arrow key has been pressed
- **THEN** the search input carries no `aria-activedescendant` attribute at all

#### Scenario: Cursor moves

- **WHEN** the user arrows to a row
- **THEN** `aria-activedescendant` names that row's id
- **AND** an element with that id exists and is the row rendered as highlighted

#### Scenario: Trigger state

- **WHEN** a picker is open
- **THEN** its trigger reports `aria-expanded="true"`, and `false` once closed

### Requirement: Reopening a picker starts from a clean state

Opening or closing a picker SHALL reset both its search query and its highlight. A search left over
from the previous visit silently hides most of the values the reopened picker exists to offer, with
nothing on screen explaining why the list is short. This reset SHALL happen before the update that
renders it, not after one has completed, so it does not schedule a second render.

#### Scenario: Reopening after a search

- **WHEN** a user narrows the list by typing, closes the picker, and reopens it
- **THEN** the full list is shown again and the search box is empty

#### Scenario: No redundant render on open or close

- **WHEN** a picker opens or closes
- **THEN** the reset does not trigger a second update pass or a change-in-update warning

### Requirement: Composing a shared stylesheet must not reorder another component's cascade

A stylesheet that is itself an array of sheets SHALL be positioned so that any sheet written to
override the shared foundation sheets keeps its place after them. The framework deduplicates a
flattened style array by keeping each sheet's **last** position, so nesting the foundation sheets
inside a composed stylesheet moves them to wherever that stylesheet is listed. Where sheets collide
at equal specificity, the ordering constraint SHALL be documented at the point that depends on it.

#### Scenario: A composed sheet is added to a component that already lists the foundations

- **WHEN** a component's style array contains both the foundation sheets and a composed sheet that
  re-lists them
- **THEN** the sheets that override the foundations still take effect
- **AND** rules such as the control bar's container layout keep the values they had before the
  composed sheet was introduced

### Requirement: The comparison and logical-operator controls remain native selects

The operator and logical-operator controls SHALL remain native `<select>` elements. They present a
handful of options with no search, and the platform supplies keyboard support, mobile pickers and
screen-reader semantics for free; replacing them with custom button-and-menu widgets to make the
pixels match would mean writing code to lose that. They SHALL instead be styled to match the design
system, with one shared indicator rule rather than a per-control copy.

#### Scenario: Operating the control on a touch device

- **WHEN** a user opens the comparison operator control on a mobile browser
- **THEN** the platform's native picker appears

#### Scenario: Consistent affordance

- **WHEN** the operator and logical-operator controls render
- **THEN** their dropdown indicator comes from one shared rule rather than a copy per control
