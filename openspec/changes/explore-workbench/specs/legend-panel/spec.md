## ADDED Requirements

### Requirement: Legend rows are compact and keep their full names

Each legend row SHALL be 28 px tall under a fine pointer (touch sizes are explore-mobile-layout's)
and show its symbol, its name
on one line and its count, which stays fully visible. A name too long for the row SHALL end in an
ellipsis; the row's accessible name SHALL hold the full name, and the full name SHALL show after
500 ms of mouse hover or a 500 ms touch hold on the truncated name (a finger that moves more than
10 px first shows nothing, and its tap acts as a tap). The legend SHALL fill the sidebar's column flush, without a card border.

#### Scenario: A long name at 240 px

- **WHEN** the sidebar is 240 px wide and a category's name has 70 characters
- **THEN** the name stays on one line and ends in an ellipsis, and its count is fully visible
- **AND** the row's accessible name holds the full name

#### Scenario: Hovering a truncated name

- **WHEN** the mouse rests on a truncated name for 500 ms
- **THEN** its full text shows; a name that fits shows nothing

#### Scenario: Coarse pointer

- **WHEN** the primary pointer is coarse
- **THEN** the rows' eye and handle always show

### Requirement: Each row has its own actions

Under a fine pointer a row's actions SHALL be hidden until the row is hovered or holds focus, and
SHALL never move its label. The actions SHALL be an eye that hides or shows the category (named
"Hide {name}" or "Show {name}") and a handle to drag the row; a row SHALL have no ⋯ menu. The row's
colour swatch SHALL be a button of its own, named "Colour and shape for {name}", that opens the
colour and shape picker beside the row (a second press closes it), says "Change colour and shape"
on hover and shows a ring on hover and while its picker is open; a press on it SHALL NOT hide or
show the category. The Other row and the rows of a numeric annotation, which have no picker, SHALL
keep a plain swatch. A hidden category's row SHALL stay in the list, dimmed, with ", hidden" at the
end of its accessible name, and SHALL show its crossed-out eye at rest in the eye's own place, so
hovering the row moves nothing.

#### Scenario: Hiding a category

- **WHEN** the user presses a row's eye
- **THEN** the category is hidden on the plot, its row stays in the list dimmed, and its
  accessible name ends in ", hidden"

#### Scenario: Hovering a hidden row

- **WHEN** the pointer reaches a hidden category's row
- **THEN** its crossed-out eye stays where it was, and nothing else in the row moves

#### Scenario: Colour and shape

- **WHEN** the user clicks a row's swatch
- **THEN** the colour and shape picker opens beside the row and the category stays shown

#### Scenario: Dragging a row

- **WHEN** the user drags a row by its handle above another row
- **THEN** the rows reorder

### Requirement: A row is hidden, shown or shown alone by click and by key

A click on a legend row SHALL hide or show its category, and a double-click SHALL show only that
category (Show all when it is already the only one shown). With focus on a row, Enter or Space
SHALL hide or show it and I SHALL show only it.

#### Scenario: Click and double-click

- **WHEN** the user clicks a row, then double-clicks another
- **THEN** the first category is hidden, then only the second category's proteins are shown

#### Scenario: Double-clicking the only category shown

- **WHEN** only one category is shown and the user double-clicks its row
- **THEN** every category is shown again

#### Scenario: Keys

- **WHEN** a row has focus and the user presses Enter, then Space, then I on another row
- **THEN** the first category is hidden and shown again, then only the other category is shown

### Requirement: Rows reorder from the keyboard

Space on a row's handle SHALL pick the row up and announce it; the arrow keys SHALL move it one
place at a time, switching the sort to Your order; Enter SHALL drop it where it is; Escape SHALL
put back the order and the sort mode it had and return focus to the handle. Each step SHALL be
announced. The Other row SHALL NOT be picked up; N/A SHALL be picked up like any category. Without
a picked row, the arrow keys, Home and End SHALL move focus between rows.

#### Scenario: Moving a row

- **WHEN** the user presses Space on a handle, then ArrowDown, then Enter
- **THEN** the row moves one place down, the sort becomes Your order and the drop is announced

#### Scenario: Cancelling

- **WHEN** the user picks a row up, moves it, and presses Escape
- **THEN** the order and the sort mode are restored and focus is on the row's handle

### Requirement: The legend header names the annotation and its sort

The header SHALL show the annotation's display name, never its key, then a sort button named
"Sort: {order}" and a Legend settings button. The sort menu SHALL offer By count, By name, Your
order and Reverse order, also when the projection has separation scores; for a numeric annotation
it SHALL offer By value, Your order and Reverse order. A pick SHALL apply at once, without a Save
step, and be stored. Settings or a bundle stored with the retired By separation order SHALL load,
sorted By count. With one row the sort button SHALL be hidden. At 240 px the title SHALL truncate
and both buttons stay fully visible.

#### Scenario: Picking By name

- **WHEN** the annotation Order is shown and the user picks By name
- **THEN** the header reads "Order", the rows are sorted by name and the order is stored

#### Scenario: The active sort

- **WHEN** an annotation is shown with its default order
- **THEN** the sort button is named "Sort: By count, largest first"

#### Scenario: A stored By separation order

- **WHEN** the legend loads settings stored with the By separation order
- **THEN** it sorts By count and keeps the rest of the stored settings

### Requirement: Other is the last row

The Other row SHALL be the legend's last row in every order, Your order and its reverse included,
however many categories are moved into Other and taken out of it.

#### Scenario: Merging and taking out in Your order

- **WHEN** the order is Your order, two rows are dropped onto Other and four categories are then
  added back to the legend from it
- **THEN** Other is still the last row, below every category taken out of it

### Requirement: Categories under Other can be brought back

When the legend groups categories under Other, the Other row's View button SHALL open a dialog
named "Other categories" with focus in its search field, listing those categories by count,
largest first, then by name. The search SHALL filter by display name, N/A included. Each row's Add
to legend button (named with its category) SHALL move that category into the legend and keep the
dialog open with focus on the next row's button; Add all SHALL add every one and close it. Escape
or a press outside SHALL close it and return focus to View.

#### Scenario: Searching and adding

- **WHEN** the user opens Other, types part of a name and presses Add to legend on the match
- **THEN** that category gets its own legend row and the dialog stays open

#### Scenario: Closing

- **WHEN** the dialog is open and the user presses Escape
- **THEN** it closes and focus returns to View

### Requirement: Legend settings apply live and are stored per dataset and annotation

Legend settings SHALL open in a popover named "Legend settings: {annotation}" under the settings
button, with the palettes as a radio group named Palette, Max legend items and, for a numeric
annotation, its bins and bin distribution. Every change SHALL apply at once, with no
Save or Cancel; typed numbers SHALL apply after a short pause or on Enter. Reset SHALL restore the
defaults and keep the popover open. Settings and the sort SHALL be stored under the localStorage
key `protspace:legend:{datasetHash}:{annotation}` with the field set earlier versions wrote, and
SHALL survive a reload.

#### Scenario: A palette pick

- **WHEN** the user picks a palette
- **THEN** the rows recolour at once and the choice is stored

#### Scenario: Reset

- **WHEN** the user presses Reset
- **THEN** the defaults apply and the popover stays open

#### Scenario: Reload

- **WHEN** the user changes Max legend items and the palette, then reloads
- **THEN** both are kept, under the same `protspace:legend:` key

#### Scenario: Records stored by earlier versions

- **WHEN** a legend record written by an earlier version is loaded
- **THEN** it is read unchanged and written back with the same key and fields

### Requirement: Score strips stay beside the rows

When the projection has separation scores, the legend SHALL show the score strips beside its rows,
with the cluster caveat (stats-auto-clustering) where it applies, and hovering a row with a mouse
SHALL mark that row's values on both strips; a touch SHALL NOT.

#### Scenario: Hovering a scored row

- **WHEN** the mouse hovers a legend row of a scored annotation
- **THEN** both strips mark that row's values

### Requirement: The plot's category focus lights its legend row

While the scatterplot's Shift + hover focus is on (category-focus), the legend SHALL highlight the
row of each focused category, or the Other row for a point in Other, with or without separation
scores; when the strips show, they SHALL mark the hovered point's category. A pointer on the legend
itself SHALL take precedence on the strips. The highlight SHALL clear when the focus ends.

#### Scenario: Shift over a point

- **WHEN** the user holds Shift over a point of category A
- **THEN** A's legend row is highlighted, and so is A's dot on the strips when they show

#### Scenario: Releasing Shift

- **WHEN** the user releases Shift
- **THEN** no legend row stays highlighted
