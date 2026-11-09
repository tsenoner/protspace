## RENAMED Requirements

- FROM: `### Requirement: The Tips popover lists Shift + Hover`
- TO: `### Requirement: The keyboard shortcut list names Shift + Hover`

## MODIFIED Requirements

### Requirement: The keyboard shortcut list names Shift + Hover

The Keyboard shortcuts dialog SHALL list `Shift` in its Plot section with the action "Hold over a
point to focus its category"; it opens from the Help menu, and on a phone from Help & shortcuts in
the More sheet. The key SHALL read `⇧` on Apple platforms and `Shift` elsewhere. The plot SHALL
offer no tips button of its own.

#### Scenario: Opening the keyboard shortcut list

- **WHEN** the user opens Help, then Keyboard shortcuts
- **THEN** the dialog's Plot section shows `Shift` (`⇧` on Apple platforms) with "Hold over a point
  to focus its category"
- **AND** the plot shows no tips button

## ADDED Requirements

### Requirement: The plot reports the focus to the page

The scatterplot SHALL dispatch a bubbling, composed `category-focus` event each time the focused
values change, with `detail.values` holding the focused values, or null once the focus ends.
Moving over more points with the same values SHALL NOT dispatch it again. The event SHALL be the
only change focus makes outside the plot: the legend lights the focused rows from it
(legend-panel), and nothing hidden, selected or stored changes.

#### Scenario: Focus starts and ends

- **WHEN** the user holds Shift over a point whose only value is A, then releases Shift
- **THEN** the plot dispatches `category-focus` with values `[A]`, then with null

#### Scenario: Moving within one category

- **WHEN** focus is on A and the cursor moves to another point whose only value is A
- **THEN** no further `category-focus` is dispatched
