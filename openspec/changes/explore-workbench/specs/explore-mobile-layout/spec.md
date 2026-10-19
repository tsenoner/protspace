## ADDED Requirements

### Requirement: The layout follows the window's width and height

The explore page SHALL pick one of four layouts from the window alone: `landscape` for a window in
landscape orientation that is at most 500 px tall and narrower than 951 px; otherwise `desktop`
from 951 px wide, `phone` up to 640 px wide, and `tablet` between the two. Every layout SHALL be the
same page restyled: crossing a breakpoint or turning the device SHALL keep each runtime element (the
plot, the legend, the structure viewer, the Import and Export menus, the protein search and the
query builder) as the same element, and SHALL resize the plot once.

#### Scenario: Four windows, one set of elements

- **WHEN** one session is shown at 1280 × 720, 800 × 1280, 390 × 844 and 740 × 360 px, then at
  1280 × 720 px again
- **THEN** the layouts are desktop, tablet, phone, landscape and desktop
- **AND** no runtime element is replaced along the way

#### Scenario: Turning a phone

- **WHEN** a 412 × 839 px phone is turned to 839 × 412 px and back
- **THEN** the layout becomes landscape and then phone again, the runtime elements stay the same,
  and the plot resizes exactly once per turn

#### Scenario: A short window wins over its width

- **WHEN** the window is in landscape orientation, at most 500 px tall and narrower than 951 px
- **THEN** the layout is landscape, even at a width that would otherwise be a phone's

### Requirement: Below 951 px the legend and the Filter share a panel under the plot

Below 951 px the plot SHALL come first and the legend SHALL sit in a panel below it, with Legend
and Filter tabs that switch the panel's content without resizing the plot. The tabs SHALL be a tab
list whose tabs control their tab panels, switched by click and by the arrow keys, Home and End. On
a phone the page SHALL fit one screen without scrolling the page or overflowing it sideways, the
plot SHALL keep at least 30% of the window's height in either tab, and a fold button SHALL fold the
panel to its 45 px header and unfold it again ("Fold panel" / "Unfold panel"), which resizes the
plot once and is kept in the stored layout. Opening the Filter from a status chip SHALL unfold the
panel. On a tablet the plot SHALL take about three fifths of the height below the bars, and the
structure viewer SHALL share the panel's row with the legend, each half as wide, with an empty
footer in its place until a protein is chosen; the first protein shown there SHALL NOT resize the
plot.

#### Scenario: A phone shows the plot and the panel on one screen

- **WHEN** the explore page loads on a 412 × 839 px phone
- **THEN** the plot is at least 30% of the window's height and ends where the panel begins
- **AND** the page neither scrolls nor overflows sideways

#### Scenario: A small phone in the Filter tab

- **WHEN** the window is 360 × 640 px and the user switches between the Legend and Filter tabs
- **THEN** the plot keeps at least 30% of the height in both, above the panel, and the page does not
  scroll

#### Scenario: Switching tabs keeps the plot

- **WHEN** the user taps the Filter tab and then the Legend tab
- **THEN** the panel keeps its height and position, the tapped tab is selected and focused, and the
  plot is not resized

#### Scenario: Folding the panel survives a reload

- **WHEN** the user taps Fold panel and reloads the page
- **THEN** the panel is folded to its 45 px header with the tabs still visible, its button reads
  "Unfold panel", and folding resized the plot once

#### Scenario: A filter chip unfolds the panel

- **WHEN** a filter is applied, the panel is folded, and the user opens the filter's status chip
- **THEN** the panel unfolds on the Filter tab and focus moves to the Filter heading

#### Scenario: A tablet puts the legend and the structure side by side

- **WHEN** a protein is tapped on a 768 × 1024 px tablet
- **THEN** the plot takes about three fifths of the height below the bars, and the structure viewer
  sits beside the legend in the row below, as tall and as wide as the legend

#### Scenario: A tablet's first protein does not resize the plot

- **WHEN** no protein is shown on a tablet and the user taps one
- **THEN** the empty footer beside the legend gives way to the structure viewer and the plot is not
  resized

### Requirement: A phone's bars keep the essentials and search opens over the app bar

On a phone the app bar and the view bar SHALL each be one 48 px row. The app bar SHALL show the
ProtSpace wordmark linking home, the dataset name and a search button; Import, Export, Theme, Help,
Feedback and GitHub SHALL be hidden there (the More sheet offers them), while their menus stay
rendered so they can still open. The view bar SHALL show Projection with its details button, Color
by and More. Labels SHALL show whole, each picker SHALL keep at least 48 px of its value, and
every control in both bars SHALL be at least 40 × 40 px. The search button (named "Search
proteins") and Ctrl+K or ⌘K SHALL open the search over the app bar with focus in its field; Ctrl+K
or ⌘K SHALL do nothing while a modal dialog is open. "Close search", Escape once nothing else takes
it, and focus leaving the overlay by keyboard SHALL close it, and "Close search" SHALL return focus
to the search button. A tablet SHALL keep the desktop bars.

#### Scenario: The bars on a phone

- **WHEN** the explore page opens at 360 × 740 or 412 × 839 px
- **THEN** both bars are 48 px tall, the app bar shows the wordmark, the dataset name and the search
  button, and the view bar shows Projection, its details button, Color by and More
- **AND** Import, Export, Theme and Help are hidden, no label is cut off, and every control is at
  least 40 × 40 px

#### Scenario: Searching from the search button

- **WHEN** the user taps the search button, pastes an ID and closes the search
- **THEN** the search opens over the app bar with focus in its field, the pasted ID's protein is
  selected, and Close search returns focus to the search button

#### Scenario: Ctrl+K on a phone

- **WHEN** a phone with a hardware keyboard has no dialog open and the user presses Ctrl+K
- **THEN** the search opens over the app bar with focus in its field, upright and on its side alike

#### Scenario: Ctrl+K under a dialog

- **WHEN** the Keyboard shortcuts dialog is open and the user presses Ctrl+K
- **THEN** the search stays closed, during the dialog and after it closes

#### Scenario: A tablet keeps the desktop bars

- **WHEN** the window is an 800 × 1280 px tablet
- **THEN** the app bar shows Import, Export, the Theme button and Help, with the dataset name and
  the search field unclipped

### Requirement: The More sheet holds what a phone's bars leave out

On a phone, upright or on its side, More SHALL open a bottom sheet: a modal dialog named "More" with
a close button, which Escape or a press on its backdrop also closes, returning focus to More. The
sheet SHALL hold, in order: Contours as a radio group (Off, Auto, Always), Filter with its applied
condition count, Import data, Export, Theme as a radio group (System, Light, Dark), Help & shortcuts
and Feedback; it SHALL NOT offer GitHub. Contours and Theme SHALL apply at once and keep the sheet
open. Every other row SHALL close the sheet first and then act: Filter shows the Filter tab and
focuses its heading, Import data opens the Import panel under the dataset name, Export opens the
Export menu anchored to More, and Help & shortcuts unfolds Documentation, Keyboard shortcuts and
Take the tour in place. The sheet SHALL fit the window and scroll inside itself, keeping its header
in view. While a contour mode other than Off or a filter is applied, More SHALL show a dot and its
accessible name SHALL gain ", N active"; the theme SHALL never light the dot.

#### Scenario: The sheet's rows

- **WHEN** the user taps More on a phone
- **THEN** the sheet shows the Contours and Theme radio groups and the Filter, Import data, Export,
  Help & shortcuts and Feedback rows, inside the window, with no GitHub link

#### Scenario: Contours applies in place

- **WHEN** the user picks Auto in the sheet's Contours group and then closes the sheet
- **THEN** the contour mode becomes Auto while the sheet stays open
- **AND** once it closes, More reads "More view options, 1 active" and shows its dot

#### Scenario: Export from the sheet

- **WHEN** the user taps Export in the sheet
- **THEN** the sheet closes, the Export menu opens within the window under More, and a tap outside
  it or Escape closes it, Escape returning focus to More

#### Scenario: A filter lights the dot

- **WHEN** a filter keeping some proteins is applied
- **THEN** More reads "More view options, 1 active", shows its dot, and the sheet's Filter row reads
  "1 condition"

#### Scenario: The theme leaves the dot dark

- **WHEN** the user picks Dark in the sheet's Theme group
- **THEN** the page turns dark while the sheet stays open, and after it closes More still reads
  "More view options" without a dot

#### Scenario: A short screen

- **WHEN** the sheet opens on a phone on its side
- **THEN** it fits the window with its heading in view, and its last row is reached by scrolling the
  sheet

#### Scenario: Escape one layer at a time

- **WHEN** a protein is selected and the user opens the sheet and presses Escape twice
- **THEN** the first Escape closes the sheet and returns focus to More with the selection kept, and
  the second clears the selection

### Requirement: The structure opens as a sheet on a phone

On a phone, upright or on its side, the structure viewer SHALL be a sheet. Upright it SHALL span the
window's width along its bottom edge; on its side it SHALL sit in the right-hand column, under the
legend. A protein shown while no structure is open SHALL open the sheet folded, showing only its
grip and header (56 px together), with the viewer, its colour controls and its resource links out of
sight, the Tab order and the accessibility tree. The grip and the header row SHALL fold and expand
the sheet, the header's close button SHALL NOT, and the toggle SHALL be named "Hide the structure"
while expanded. Expanded upright, the sheet SHALL rise to the window's bottom edge and take at most
half of its height, leaving part of the plot in view; on its side it SHALL cover the right half, at
least 200 px tall. Folding or expanding SHALL never resize the plot, the expanded sheet SHALL take
the panel it covers out of the Tab order, and under reduced motion it SHALL move without a
transition. While the sheet is expanded, a tap on a protein above it SHALL select that protein
without opening a tooltip; while it is folded, the tapped protein's tooltip SHALL lie clear of it,
and the tooltip's "View structure" SHALL expand it. Closing the structure SHALL reset the sheet, so
the next protein opens it folded again.

#### Scenario: A first tap opens the sheet folded

- **WHEN** the user taps a protein on a phone with no structure open
- **THEN** the sheet shows only its 56 px header strip at the bottom edge, below the plot
- **AND** the protein's tooltip is shown with "View structure" and does not overlap the sheet

#### Scenario: Expanding the sheet

- **WHEN** the user taps the folded sheet's grip or header
- **THEN** the sheet spans the window's width, ends at its bottom edge, and is at most half of its
  height, with the plot still in view above it

#### Scenario: Tapping above an expanded sheet

- **WHEN** the sheet is expanded and the user taps a protein above it
- **THEN** the protein is selected, the sheet stays expanded, and no tooltip opens

#### Scenario: View structure expands the sheet

- **WHEN** the sheet is folded, a tapped protein's tooltip is shown, and the user taps "View
  structure"
- **THEN** the sheet expands and the tooltip closes

#### Scenario: Closing starts over

- **WHEN** the user closes the structure and then taps another protein
- **THEN** the sheet opens folded again

#### Scenario: The sheet never resizes the plot

- **WHEN** the user folds and expands the sheet
- **THEN** the plot keeps its size

#### Scenario: The sheet on a phone on its side

- **WHEN** a protein is tapped and its sheet expanded on a 740 × 360 px screen
- **THEN** the folded sheet first sits under the legend in the right-hand column, and the expanded
  sheet covers at least half the width, is at least 200 px tall and lies within the window
- **AND** its close button covers none of its resource links

### Requirement: A phone on its side scrolls once to a full-screen plot

In the landscape layout the app bar and the view bar SHALL share one 44 px row, with the search
button before Projection in the Tab order and the search overlay covering the whole row. The page
SHALL scroll past that row to a plot-and-legend row exactly one screen tall, with the legend to the
right of the plot. There the legend's rows SHALL show each category's name, count and eye only,
keeping at least 110 px for the name, and the legend header SHALL fit with its sort button.

#### Scenario: Turning the phone sideways

- **WHEN** the explore page is open at 740 × 360 px and the page is scrolled to its end
- **THEN** the plot lies wholly inside the screen, the plot-and-legend row is the screen's height,
  and the legend sits to the right of the plot

#### Scenario: The landscape bar

- **WHEN** the explore page opens at 740 × 360 px
- **THEN** the app bar and the view bar sit side by side in one 44 px row that fits the screen
- **AND** Tab moves from the search button to Projection, and the search overlay spans the row

#### Scenario: The legend column

- **WHEN** the explore page opens at 740 × 360 or 844 × 390 px
- **THEN** each legend row shows its eye but no drag handle or row menu, its name keeps at least
  110 px, and the legend header does not overflow

### Requirement: A touch screen gets finger-sized targets and touch gestures

Under a coarse pointer every control the explore page draws SHALL be at least 40 × 40 px: the
legend's row controls and header buttons, the bars, the structure viewer's resource links, colour
options, close button and protein pick, a filter value's remove button and every segmented option; a
fine pointer keeps the compact sizes. On the plot, a pinch SHALL zoom the plot and never the page, a
one-finger drag SHALL pan it, and a tap on a point SHALL select it and pin a compact card inside the
plot, clear of the tool strip, the status corner and the protein it names. A tap on empty space or
the start of a pan SHALL close the card. In the legend, a tap SHALL hide or show a category, a
double tap SHALL show only that category even where the browser sends no double-click, a swipe that
starts on a drag handle SHALL scroll the rows, and a long press on a drag handle SHALL lift the row
to reorder it. On a phone, and on any touch screen in dark, unselected points SHALL fade to 25%
rather than the plot's usual 15%, so the plot around a tapped protein stays readable.

#### Scenario: Pinching the plot

- **WHEN** two fingers spread apart on the plot
- **THEN** the plot zooms in, and the page itself neither scrolls nor zooms

#### Scenario: Tapping near the edge

- **WHEN** a protein near the right edge of the plot is tapped
- **THEN** its card lies wholly inside the plot, overlaps neither the tool strip nor the status
  corner, and nothing in it is cut off

#### Scenario: Closing the card

- **WHEN** a card is pinned and the user taps empty plot space, or pans the plot
- **THEN** the card closes

#### Scenario: The legend under a finger

- **WHEN** the legend is shown on a phone
- **THEN** each row's eye, drag handle and menu button and the header's sort and settings buttons
  are at least 40 × 40 px, and a one-line row is at most 44 px tall

#### Scenario: Reordering by touch

- **WHEN** the user presses a drag handle for longer than a quarter second and drags down past the
  next row
- **THEN** the two rows swap places, and a quick swipe from a handle scrolls the list instead

#### Scenario: A double tap without a double-click

- **WHEN** the browser sends no double-click event and the user taps a legend row twice quickly
- **THEN** only that category is shown

#### Scenario: Dimming on a dark touch screen

- **WHEN** the page is dark on a touch screen of any layout, or the layout is a phone's
- **THEN** unselected points fade to 25%, and elsewhere to the plot's own 15%

### Requirement: Dialogs and popovers fit a phone

On a phone every dialog, menu and popover the explore page opens SHALL lie within the window or
scroll inside itself, with its close or cancel control on screen without scrolling the page: the
More sheet, the Import panel, the Export menu, the Color by picker and its info bubble, the
projection details card, the legend's settings popover, the colour picker and the Other popover
opened from a full-width legend row, the Filter builder with its actions, the confirmation dialogs
and the Figure editor. The Figure editor SHALL stack its preview above its settings upright and
place them side by side on a phone on its side, with 40 px targets.

#### Scenario: The legend settings on a phone

- **WHEN** the user opens the legend's settings on a phone
- **THEN** the popover lies within the window and its Reset button is on screen and at least 40 px
  tall

#### Scenario: The Figure editor on a phone

- **WHEN** the Figure editor opens on a phone, upright and on its side
- **THEN** it lies within the window, stacked upright and side by side on its side, and its
  controls are at least 40 px

#### Scenario: A confirmation on a 360 px phone

- **WHEN** the user taps the dataset name, and later "Clear stored data" in the recovery banner,
  on a 360 × 740 px phone
- **THEN** the Import panel and the "Clear stored data?" dialog each lie within the window, the
  dialog's Cancel and Clear data buttons included

#### Scenario: Popovers from a legend row

- **WHEN** the colour picker or the Other popover opens from a full-width legend row on a phone
- **THEN** it stays inside the window

#### Scenario: The Export menu on a phone on its side

- **WHEN** the user taps Export in the More sheet on a 740 × 360 px screen
- **THEN** the Export menu lies within the window and its list scrolls inside it, down to Include
  legend settings

#### Scenario: The Filter builder on a phone

- **WHEN** the user opens the Filter tab on a phone
- **THEN** the builder shows with its Reset, Cancel and Apply actions on screen
