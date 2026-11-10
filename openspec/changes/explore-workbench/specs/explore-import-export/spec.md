## ADDED Requirements

### Requirement: Import and the dataset name open one Import panel

The app bar's Import button and the dataset name SHALL open the same Import panel, a dialog named
Import, under whichever was pressed, with focus on its first action. The panel SHALL offer Open a
file…, which opens the file chooser, then Last file and the example datasets as
example-datasets describes them, and last Export…, which closes the panel and opens the Export
panel under the same control.
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

### Requirement: The Export panel asks what, then how

Export… in the dataset name's Import panel (on a phone, Export in the More sheet) SHALL open a
dialog named Export, a bottom sheet on a phone, with focus on its first choice. It SHALL first ask
what to export, as a radio group: Image, Protein IDs, Table and Data bundle, Image chosen at first
and the last choice kept for the next opening. Under it SHALL show only that choice's options: for
Image, the format (PNG or PDF) and a note that the image is the current view at the default size
without contours; for Data bundle, an Include legend settings checkbox, checked by default and
again for each new dataset, with what it restores, and, when the loaded file carries saved
settings, the note "The loaded file contains custom settings."; for Protein IDs and Table, what the
file holds. One primary button SHALL name the file (Download PNG, Download PDF, Download .txt,
Download .tsv, Download .parquetbundle), close the panel and export at the default sizes. Escape, a
press outside or Tab out of the panel SHALL close it, Escape returning focus to the control that
opened it. The figure editor SHALL NOT be in the panel.

#### Scenario: The choices

- **WHEN** the user opens Export
- **THEN** it asks what to export (Image, Protein IDs, Table, Data bundle), with Image and PNG
  chosen and Download PNG

#### Scenario: The bundle's settings

- **WHEN** the user chooses Data bundle
- **THEN** the format goes, Include legend settings shows checked, and the button reads Download
  .parquetbundle

### Requirement: The figure editor has its own button

The app bar SHALL show a Figure editor button at its right, before the theme switch, Help,
Feedback and GitHub: labelled with an image icon on a desktop, the icon alone named by its tooltip
on a tablet. On a phone, upright or on its side, the More sheet's Figure editor row SHALL take its
place. Either SHALL open the figure editor and export nothing.

#### Scenario: Figure editor

- **WHEN** the user presses Figure editor in the app bar
- **THEN** the figure editor opens and nothing is exported

### Requirement: Every export says it is done

A finished export SHALL show the notification "Export ready." naming the file it wrote; a data
bundle that leaves out proteins the loaded file holds SHALL also say how many and that `protspace
convert` keeps them. An export that fails SHALL say so in a notification, or, for the figure
editor, inside the editor, which stays open.

#### Scenario: An image

- **WHEN** the user chooses Image and PNG and presses Download PNG
- **THEN** a PNG downloads and "Export ready." shows with its file name

#### Scenario: Protein IDs

- **WHEN** the user chooses Protein IDs and presses Download .txt
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
it is doing: a local bundle is "Reading your file in the browser" and "Reading {name}…", never an
upload; a FASTA file, which is sent to the server, is "Preparing FASTA…" and "Uploading to the
embedding server…"; an example is "Opening {label}"; a stored file is reopened "from this browser". While it
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
