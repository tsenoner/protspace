## ADDED Requirements

### Requirement: Import and the dataset name open one Import panel

The app bar's Import button and the dataset name SHALL open the same Import panel, a dialog named
Import, under whichever was pressed, with focus on its first action. The panel SHALL offer Open a
file…, which opens the file chooser; Last file, only while a file the user imported is stored in
the browser, which reopens it; and the example datasets, the current one disabled with a check.
It SHALL say which files are read in the browser and which are sent to the server
(".parquetbundle files are read in your browser. FASTA files (.fasta, .fa, .fna) are sent to the
server for embedding."). The arrow keys SHALL move between its actions, skipping the disabled
example; Escape, a press outside or Tab out of it SHALL close it, Escape returning focus to the
button that opened it.

#### Scenario: The dataset name

- **WHEN** the user presses the dataset name and picks an example
- **THEN** the Import panel opens under the name and the example replaces the dataset

#### Scenario: Last file

- **WHEN** the user imported a file, then loaded an example, and opens Import
- **THEN** Last file is offered and reopens the imported file

#### Scenario: Open a file

- **WHEN** the user picks Open a file…
- **THEN** the panel closes and the file chooser opens

### Requirement: The Export menu lists every export

The app bar's Export button SHALL open a menu named Export with, in this order: Figure editor…,
Quick PNG, Quick PDF, Protein IDs (.txt), Table (.tsv) and Data bundle (.parquetbundle), then an
Include legend settings checkbox, checked by default and again for each new dataset, that applies
to the data bundle and keeps the menu open, and the note "Quick exports leave out contours.",
which describes Quick PNG and Quick PDF. A quick item SHALL close the menu and export at once at
the default sizes; Escape SHALL close the menu and return focus to its button.

#### Scenario: The items

- **WHEN** the user opens Export
- **THEN** it names the six exports in order, the checked Include legend settings and the contours
  note

#### Scenario: Figure editor

- **WHEN** the user picks Figure editor…
- **THEN** the figure editor opens and nothing is exported

### Requirement: Every export says it is done

A finished export SHALL show the notification "Export ready." naming the file it wrote; a data
bundle that leaves out proteins the loaded file holds SHALL also say how many and that `protspace
convert` keeps them. An export that fails SHALL say so in a notification, or, for the figure
editor, inside the editor, which stays open.

#### Scenario: Quick PNG

- **WHEN** the user picks Quick PNG
- **THEN** a PNG downloads and "Export ready." shows with its file name

#### Scenario: Protein IDs

- **WHEN** the user picks Protein IDs (.txt)
- **THEN** a .txt file downloads

#### Scenario: A failed export

- **WHEN** an export fails
- **THEN** a notification says it failed

### Requirement: The figure editor is a modal dialog that keeps its work

The figure editor SHALL open as a modal dialog named Figure editor that a press on the backdrop
does not close. Escape SHALL first deselect a selected item, then close the editor; it SHALL never
clear the plot's selection. Closing it by Escape, its Close button or its ✕ SHALL keep its state
under the localStorage key `protspace_publishState` for the next opening and SHALL return focus to
the control that opened it.

#### Scenario: Escape

- **WHEN** an item is selected in the figure editor and the user presses Escape twice
- **THEN** the first press deselects it, the second closes the editor, and the plot's selection
  stays

#### Scenario: Closing keeps the figure

- **WHEN** the user closes the figure editor
- **THEN** its state is kept for the next opening and focus returns to the control that opened it

### Requirement: The loading overlay says what is happening

While a dataset loads, the overlay `#progressive-loading` SHALL cover the workbench and say what
it is doing: a local file is "Reading your file in the browser" and "Reading {name}…", never an
upload; an example is "Opening {label}"; a stored file is reopened "from this browser". While it
shows, Tab SHALL NOT reach the workbench. When the load ends, focus SHALL return to the control
that started it, not to the page.

#### Scenario: A local file

- **WHEN** the user imports a local bundle
- **THEN** the overlay says the file is read in the browser and never mentions an upload

#### Scenario: Tab during a load

- **WHEN** a load is under way and the user presses Tab
- **THEN** focus does not reach the app bar

#### Scenario: Focus after a load

- **WHEN** the user starts loading an example from the dataset name and it finishes
- **THEN** focus is on the dataset name
