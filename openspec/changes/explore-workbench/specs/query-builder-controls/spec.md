## MODIFIED Requirements

### Requirement: Query builder controls carry the design system's focus indicator

Every interactive control in the query builder SHALL show the design system's focus indicator rather
than the browser's default. The query builder's stylesheet SHALL compose the kit's shared focus-ring
sheet and read the `--ps-*` tokens instead of restating the ring, because the row and picker
components have their own shadow roots and inherit custom properties but not component classes from
the Filter panel around them. Where a control's box needs the ring placed differently, as the
pickers' search fields and the number fields draw it on their border, the stylesheet SHALL change
only the ring's offset, never its colour or width.

#### Scenario: Focusing the comparison operator

- **WHEN** a user tabs to the numeric comparison operator control
- **THEN** it shows the design system's focus ring
- **AND** not the browser's default focus ring, which follows the operating system accent colour and
  can render as an unrelated colour

#### Scenario: A control that draws the ring on its border

- **WHEN** a number field or a picker's search field has keyboard focus
- **THEN** it shows the same ring, in the design system's focus colour and width, on its border
- **AND** the stylesheet keeps only the offset as a local declaration for that control

#### Scenario: Picker rendered outside the Filter panel's shadow root

- **WHEN** a picker component renders in its own shadow root
- **THEN** its controls are styled identically to the same controls elsewhere in the app

### Requirement: The picker option lists are navigable by keyboard

Both query builder pickers SHALL support the same keyboard contract as the app's other searchable
dropdowns: `ArrowDown` and `ArrowUp` walk the filtered list and SHALL clamp at each end rather than
wrapping, `Enter` commits the current row, and `Escape` closes the dropdown. An open picker SHALL be
the top layer of the page's Escape order, so `Escape` closes only the picker and not the dialog
around it or anything the next Escape would close. Opening a closed picker from its trigger SHALL
be possible with `Enter` or `Space`. This contract SHALL be stated once and shared by every
component that implements a searchable listbox, so the keyboard does not behave differently from
one dropdown to the next.

#### Scenario: Walking the list

- **WHEN** the picker is open and the user presses ArrowDown repeatedly
- **THEN** the highlight advances one row at a time through the filtered list
- **AND** stops on the last row rather than wrapping to the first

#### Scenario: Escape with a picker open

- **WHEN** the user presses Escape with a picker open in the query builder
- **THEN** the picker closes
- **AND** the Filter panel stays open and the selection is kept

#### Scenario: Opening from the trigger

- **WHEN** the trigger has keyboard focus and the user presses Enter or Space
- **THEN** the picker opens
- **AND** does not immediately toggle back shut from the same keypress

#### Scenario: A locked-out list

- **WHEN** every entry is locked out because the exclusive "Any value" sentinel is selected
- **THEN** the arrows do not move the highlight and Enter commits nothing, matching the pointer

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
- **AND** rules such as the query builder's own host layout, listed after its shared sheet, keep the
  values they had before the composed sheet was introduced
