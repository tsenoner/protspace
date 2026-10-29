## ADDED Requirements

### Requirement: A tool strip picks how the plot is selected

The plot's top-left corner SHALL hold a tool strip with Move and zoom, Box select, Lasso select
and Fit to view, each named for assistive technology, the current tool pressed. The strip SHALL be
one Tab stop (the current tool) whose arrow keys move between the tools, Fit to view included.
Box select and Lasso select SHALL be disabled while selection is unavailable. Under a coarse
pointer the tool buttons take the touch size explore-mobile-layout sets.

#### Scenario: Box select

- **WHEN** the user chooses Box select and drags over the plot
- **THEN** the proteins inside the box are selected

#### Scenario: Keyboard

- **WHEN** the current tool has focus and the user presses the arrow keys
- **THEN** focus moves between the tools and reaches Fit to view

### Requirement: The selection bar acts on the selected proteins

While proteins are selected, a toolbar named Selection SHALL show at the bottom centre of the plot
with the count ("1 protein selected", "1,234 proteins selected", announced from a live region)
and the actions Show only these, Zoom to them, Copy IDs and Clear, which form one Tab stop moved by
the arrow keys. Show only these SHALL isolate the selection (point-visibility) and hide the bar,
and SHALL be disabled when the selection cannot be isolated. Zoom to them SHALL zoom the plot onto
the selection. Copy IDs SHALL write the ids, one per line, to the clipboard and say "Copied N
protein IDs". Clear SHALL empty the selection, and focus SHALL stay on the tool strip rather than
fall to the page.

#### Scenario: Showing the bar

- **WHEN** the user box-selects several proteins
- **THEN** the selection bar shows their count

#### Scenario: Show only these

- **WHEN** the user presses Show only these
- **THEN** only the selected proteins remain on the plot and the bar hides

#### Scenario: Copy IDs

- **WHEN** two proteins are selected and the user presses Copy IDs
- **THEN** the clipboard holds their two ids and "Copied 2 protein IDs" shows

#### Scenario: Clear

- **WHEN** the user presses Clear
- **THEN** the selection is empty and focus is on the tool strip

### Requirement: Status chips show what narrows the view

The plot's bottom-left corner SHALL show the protein count (with " · Zoomed in" while zoomed, as a
`role="status"` region) and, in this order, a chip for each active narrowing: "Filtered · N
conditions", "Showing only N proteins · N steps" and "N categories hidden", each plural-aware. The
filter and hidden-categories chips SHALL open where they are changed (the Filter panel; the
legend); every chip SHALL have its own ✕ with its own accessible name that undoes what it shows:
the filter chip's ✕ removes the filter, the isolation chip's ✕ returns the full view, and the
hidden chip's ✕ shows the hidden categories. Removing a focused chip SHALL move focus to the next
chip, else to the count. The explore page SHALL hide the scatterplot's own point-count indicator
(scatterplot-zoom-indicator; `hide-status` on `#myPlot`), so this count, " · Zoomed in" included, is
the only one on the plot.

#### Scenario: Applying a filter

- **WHEN** the user applies a filter with one condition
- **THEN** a chip reads "Filtered · 1 condition", pressing it opens the filter, and its ✕
  removes the filter

#### Scenario: Show only these

- **WHEN** the user isolates a selection
- **THEN** a chip reads "Showing only N proteins · 1 step", and its ✕ returns the full view

#### Scenario: Hiding a category

- **WHEN** the user hides one legend category
- **THEN** a chip reads "1 category hidden", and its ✕ shows it again

### Requirement: Undo and redo step through selection changes

Mod+Z (⌘ on Apple platforms, Ctrl elsewhere) SHALL undo the last selection step (a selection, Show
only these, a filter applied or removed) and Mod+Shift+Z SHALL redo it. Neither SHALL act while
focus is in a text field (the browser's own undo applies there), while a dialog is open, or while
a dataset loads. A new step SHALL clear what could be redone; the history SHALL keep the newest
100 steps and drop the oldest past a total of 2,000,000 ids, and loading another dataset SHALL
clear it.

#### Scenario: Undo and redo a box selection

- **WHEN** the user box-selects, presses Ctrl+Z, then Ctrl+Shift+Z
- **THEN** the selection empties, then comes back

#### Scenario: Undo Show only these

- **WHEN** the user isolates a selection and presses Ctrl+Z
- **THEN** the full view and the selection return

#### Scenario: In the search box

- **WHEN** focus is in the search box and the user presses Ctrl+Z
- **THEN** the selection is unchanged

#### Scenario: A new dataset

- **WHEN** another dataset loads
- **THEN** nothing can be undone

### Requirement: Undoable resets offer an Undo

Removing the filter with Reset in the Filter panel or with the filter chip's ✕ SHALL show a "Filter
removed" notification with an Undo button that takes back that step of the undo history; a newer
step SHALL dismiss that notification. In the figure editor, New figure and Reset SHALL offer
Undo, which brings the previous figure back.

#### Scenario: Reset in the Filter panel

- **WHEN** the user resets an applied filter in the Filter panel
- **THEN** a "Filter removed" notification with Undo shows, and its Undo is the history step
  query-builder-filtering records

#### Scenario: A newer step

- **WHEN** a "Filter removed" notification shows and the user makes another selection change
- **THEN** the notification goes

#### Scenario: New figure

- **WHEN** the user presses New figure in the figure editor and then Undo
- **THEN** the overlays and insets come back

### Requirement: Clearing stored data asks first

The recovery banner's Clear stored data SHALL open a dialog named "Clear stored data?" whose Cancel
has focus and keeps the banner; only its Clear data SHALL clear the stored data and load the
default dataset. The banner's Load default SHALL likewise ask first, in a dialog named "Load the
default dataset?", whose Load default alone deletes the stored import and loads the default
dataset.

#### Scenario: Confirming

- **WHEN** the user presses Clear stored data, then Clear data
- **THEN** the stored data is cleared and the default dataset loads

#### Scenario: Cancelling

- **WHEN** the user presses Clear stored data, then Cancel
- **THEN** the banner stays and nothing is cleared

### Requirement: The user picks which selected protein the structure shows

When several proteins are selected, the structure viewer's header SHALL show a "Structure protein"
button whose menu lists the selected proteins with the shown one checked; picking another SHALL
show its structure and keep the selection.

#### Scenario: Several proteins selected

- **WHEN** the user box-selects several proteins and picks another one from the structure's header
- **THEN** the structure of that protein shows and the selection is unchanged
