## ADDED Requirements

### Requirement: The explore page is a workbench with its own app bar

The /explore page SHALL replace the site header with a 48 px app bar (`role="banner"`) that has no
site navigation: no Home or Docs link and no Resources menu; the ProtSpace mark SHALL link to `/`.
The app bar SHALL name the loaded dataset and its protein count, formatted in the browser's
locale, as "{name} · {count} proteins". Below it a view bar, the plot area and a right-hand
sidebar (`role="complementary"`, named "Sidebar", 300 px wide by default) SHALL share the screen.
The landing and privacy pages SHALL keep the site header.

#### Scenario: No site navigation on /explore

- **WHEN** the user opens /explore
- **THEN** the page shows the app bar and no Home link, Docs link or Resources menu
- **AND** the ProtSpace mark links to `/`

#### Scenario: The dataset and its size

- **WHEN** a dataset is loaded
- **THEN** the app bar shows the dataset's name followed by "· N proteins", N being its protein
  count in the browser's number format

#### Scenario: Other pages keep the site header

- **WHEN** the user opens the landing page or the privacy page
- **THEN** the site header with its navigation is shown

### Requirement: The view bar keeps one row

The view bar SHALL hold Projection with its details, Color by, Contours and Filter in a single row
at least 44 px tall that never wraps or overflows. When the row runs out of width it SHALL first
drop the visible keys "Projection", "Color by" and "Contours" (the accessible names keep them),
then move Contours, then Filter, into its More menu, and SHALL bring them back as the width
returns. A window resized back and forth by a few pixels around a threshold SHALL keep its stage.

#### Scenario: Common desktop widths

- **WHEN** the window is 1440, 1280, 1024 or 951 px wide
- **THEN** the view bar is one row that does not overflow

#### Scenario: Narrowing and widening

- **WHEN** the window narrows until the row no longer fits
- **THEN** Contours moves into More, then Filter
- **AND** widening the window brings them back into the row

#### Scenario: More marks an active control inside it

- **WHEN** Contours sits in More and a contour mode other than Off is on
- **THEN** More shows a dot

### Requirement: The sidebar folds to a rail and resizes

The sidebar SHALL keep a 44 px rail with Legend, Structure and Filter items and a Collapse sidebar
/ Expand sidebar toggle that stays visible, named and stateful (`aria-pressed`, `aria-expanded`)
while the sidebar is collapsed; what the Filter item opens is query-builder-filtering's. A
collapsed sidebar SHALL be inert. Its left edge SHALL be a separator the user drags
or moves with the arrow keys (Shift for larger steps, Home and End for the ends): a drag SHALL
preview over the plot and commit on release. The width SHALL stay within 240–480 px and SHALL be
clamped further so the plot keeps at least 480 px of the window.

#### Scenario: Collapse and expand from the rail

- **WHEN** the user collapses the sidebar
- **THEN** the rail stays visible at 44 px with Legend, Structure and Expand sidebar
- **AND** Legend opens the sidebar again

#### Scenario: Dragging the edge

- **WHEN** the user drags the sidebar's edge past 480 px or below 240 px and releases
- **THEN** the drag previews over the plot and the width is committed on release, clamped to
  240–480 px

#### Scenario: Moving the edge by keyboard

- **WHEN** the edge separator has focus and the user presses an arrow key
- **THEN** the width changes by one step and is committed once

#### Scenario: A protein clicked while collapsed

- **WHEN** the sidebar is collapsed and the user clicks a protein
- **THEN** the rail's Structure button shows a dot, and Structure opens the sidebar with that
  protein's structure

### Requirement: The legend and the structure share the sidebar under a divider

Before any protein is clicked the sidebar SHALL show the legend at full height over a Structure
footer. Once a structure opens, a divider SHALL split the sidebar between the legend (at least
120 px) and the structure (at least 220 px); the divider SHALL move by drag and by keyboard (5 %
per arrow, 20 % with Shift), and its position SHALL be kept across a reload. Moving the divider
SHALL NOT resize the plot. Close structure SHALL bring the footer back, and loading another
dataset SHALL clear the structure.

#### Scenario: A first protein click

- **WHEN** the user clicks a protein
- **THEN** its structure shows under a divider and the plot keeps its size

#### Scenario: Moving the divider

- **WHEN** the user drags the divider or moves it with the keyboard and reloads
- **THEN** the legend and structure keep the new split and the plot is never resized

#### Scenario: Closing the structure

- **WHEN** the user presses Close structure
- **THEN** the legend fills the sidebar again over the Structure footer

### Requirement: The structure docks in the sidebar or floats over the plot

At 951 px and wider the structure SHALL offer Pop out, which floats it as a card over the plot,
and Dock structure, which puts it back; switching SHALL keep the same viewer and SHALL NOT reload
the structure or resize the plot. The floating card SHALL be at least 280 × 240 px, move by its
header and resize by its grip (a 24 px target) with the pointer or the keyboard, stay inside the
plot area, and be kept across a reload. The default card SHALL leave the selection bar's Copy IDs
and Clear clickable. Below 951 px there SHALL be no Pop out, and a stored floating card SHALL show
docked.

#### Scenario: Pop out

- **WHEN** the user presses Pop out
- **THEN** the structure floats as a card over the plot and the plot keeps its size

#### Scenario: The default card clears the selection bar

- **WHEN** the card floats at its default place while proteins are selected
- **THEN** Copy IDs and Clear on the selection bar stay clickable

#### Scenario: A card stored outside the plot

- **WHEN** the stored card lies outside the plot area, or a shrinking window leaves it outside
- **THEN** the card renders inside the plot area

#### Scenario: Below desktop width

- **WHEN** the window is narrower than 951 px and the stored placement is floating
- **THEN** the structure shows docked and no Pop out is offered

### Requirement: The layout is stored per browser, never in the URL

The layout SHALL be stored under the localStorage key `protspace:layout:v1` and SHALL NOT appear
in the URL: the sidebar's open state and width, the legend/structure split, the structure's
placement and the floating card. A stored value of the wrong type, out of range, non-finite or
unparsable, or a storage that throws, SHALL load the defaults for the fields it affects, and the
page SHALL still load.

#### Scenario: Reload keeps the layout

- **WHEN** the user collapses or resizes the sidebar and reloads
- **THEN** the sidebar has the same width and state
- **AND** the URL holds no layout parameter

#### Scenario: A corrupt stored layout

- **WHEN** `protspace:layout:v1` holds garbage, an array, or out-of-range numbers
- **THEN** the page loads with the defaults for the bad fields, sizes clamped to their ranges

### Requirement: Files are opened by dropping them anywhere, or from the empty state

A file dragged over any part of the workbench (plot, sidebar, docked structure) SHALL show a drop
area reading "Drop to open this file", and dropping it SHALL load it. Dragging a legend row SHALL
NOT show the drop area. A file dropped outside the workbench, such as on the loading overlay, SHALL
NOT be opened by the browser. When nothing is loaded the plot SHALL show an empty state, "Drop a
file or pick an example", with Open a file… and Pick an example; it SHALL never cover the recovery
banner's buttons.

#### Scenario: Dropping on the sidebar

- **WHEN** the user drags a file over the sidebar and drops it
- **THEN** the drop area shows during the drag and the file loads

#### Scenario: Dragging a legend row

- **WHEN** the user drags a legend row
- **THEN** no drop area shows

#### Scenario: Nothing loaded

- **WHEN** startup ends with no dataset on screen
- **THEN** the empty state shows, Open a file… opens the file chooser and Pick an example opens
  the Import panel at the button
- **AND** a file dropped on the plot loads and the empty state goes

### Requirement: Notifications appear over the plot's bottom edge

Notifications SHALL sit inside the plot area's horizontal span, at most 360 px wide, without
overlapping the legend, and above the selection bar while proteins are selected.

#### Scenario: A notification beside the sidebar

- **WHEN** a notification shows
- **THEN** it lies within the plot's horizontal span and does not intersect the legend

#### Scenario: A notification with a selection

- **WHEN** proteins are selected and a notification shows
- **THEN** it sits above the selection bar
