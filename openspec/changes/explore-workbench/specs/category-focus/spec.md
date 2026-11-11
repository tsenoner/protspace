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

### Requirement: The legend's score hover focuses its category in the plot

The plot SHALL focus a category, exactly as Shift + hover over one of its points does, while the
pointer is on that category's dot in a separation-score strip, and while the pointer is on a legend
row of a scored annotation with Shift held; the Other row SHALL focus every category under it. No
Shift is needed on a strip dot, and a dot of a category under Other SHALL focus only that category.
Shift + hover over a point in the plot SHALL take precedence, a selection SHALL outrank the focus as
it does Shift + hover's, and the focus SHALL end when the pointer leaves the dot or row, when Shift
is released on a row, when the window loses focus, and when the dataset or the annotation changes.
The plot SHALL report this focus through category-focus like its own.

#### Scenario: Hovering a strip dot

- **WHEN** the user hovers category A's dot on the silhouette strip
- **THEN** every point outside A fades, and A's legend row is highlighted
- **AND** moving the pointer off the dot restores the plot

#### Scenario: Shift on a scored row

- **WHEN** the user holds Shift with the pointer on category B's legend row
- **THEN** every point outside B fades until Shift is released or the pointer leaves the row

#### Scenario: A row without Shift

- **WHEN** the pointer crosses legend rows without Shift
- **THEN** the plot does not fade

#### Scenario: A selection is active

- **WHEN** proteins are selected and the user hovers a strip dot
- **THEN** the plot keeps showing the selection and does not fade by category
