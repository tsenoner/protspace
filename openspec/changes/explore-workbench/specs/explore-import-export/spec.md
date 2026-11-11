## ADDED Requirements

### Requirement: The dataset name opens the Import panel

The app bar's dataset name SHALL open the Import panel, a dialog named Import, under itself, with
focus on its first action. While no dataset is loaded the dataset name's place SHALL read Import
and open the same panel. The panel SHALL offer Open a file…, which opens the file chooser, then
Last file and the example datasets as example-datasets describes them; it SHALL only import, and
SHALL NOT offer Export. It SHALL say which files are read in the browser and which are sent to the server
(".parquetbundle files are read in your browser. FASTA files (.fasta, .fa, .fna) are sent to the
server for embedding."). The arrow keys SHALL move between its actions, skipping the disabled
example; Escape, a press outside or Tab out of it SHALL close it, Escape returning focus to the
button that opened it.

#### Scenario: The dataset name

- **WHEN** the user presses the dataset name and picks an example
- **THEN** the Import panel opens under the name and the example replaces the dataset

#### Scenario: Import only

- **WHEN** the user opens the Import panel from the dataset name
- **THEN** it offers Open a file…, Last file and the examples, and no Export

#### Scenario: Nothing loaded

- **WHEN** startup ends with no dataset on screen
- **THEN** the dataset name's place reads Import and opens the Import panel under itself

#### Scenario: Last file

- **WHEN** the user imported a file, then loaded an example, and opens Import
- **THEN** Last file is offered and reopens the imported file

#### Scenario: Open a file

- **WHEN** the user picks Open a file…
- **THEN** the panel closes and the file chooser opens

### Requirement: Last file can be removed from the browser

Last file SHALL carry a red × beside its row, named "Remove {file} from this browser", that asks
before it deletes the copy of that file stored in the browser. Delete or Backspace on the focused
row SHALL ask the same (the row announces them as its key shortcuts); the × SHALL be a Tab stop
outside the arrow-key order. The question SHALL be a dialog that names the file, says the stored
copy is deleted and cannot be undone and that the file's legend settings are kept, with a red
Remove button and Cancel focused; the Import panel SHALL stay open behind it. On Remove the stored
copy SHALL be deleted, the legend settings and the dataset on screen SHALL stay, Last file SHALL
no longer be offered (also after a reload, which then opens the startup demo), a notification
SHALL name the removed file, and focus SHALL move to the next item of the panel. Cancel SHALL keep
the file and return focus to the control that asked. A file imported after the question was asked
SHALL never be removed by it: it stays, and a warning says so. As before, Last file and its × SHALL
not show while that file is on screen.

#### Scenario: Removing Last file

- **WHEN** the user imported a file, loaded an example, presses the × beside Last file and
  confirms Remove
- **THEN** the stored copy is deleted, a notification names the file, and Last file is no longer
  offered, also after a reload

#### Scenario: Cancelling the removal

- **WHEN** the user presses Delete on the focused Last file row and then Cancel
- **THEN** the stored copy stays, Last file is still offered and focus is back on its row

### Requirement: Export has its own button in the app bar

The app bar SHALL show an Export button after search and just before the Figure editor, and a thin
divider SHALL separate these two task buttons from the theme switch, Help, Feedback and GitHub,
which keep their places; below 820 px the divider SHALL be left out, so search keeps the room to
show its placeholder whole. From 1200 px wide the button SHALL show a download icon, the label Export
and a chevron; below it, the download icon and a small chevron, named Export by its tooltip. It
SHALL open the Export panel under itself, its right edge lined up with the button's, and a second
press SHALL close it; Escape SHALL return focus to it. While no dataset is loaded it SHALL stay in
the bar and in the Tab order, greyed through `aria-disabled` rather than `disabled`, open nothing,
and be described by the tooltip "Load a dataset to export". It SHALL have no keyboard shortcut of
its own. On a phone, upright or on its side, the More sheet's Export row SHALL take its place, and
while no dataset is loaded it SHALL likewise be greyed through `aria-disabled`, say "Load a dataset
to export" and open nothing.

#### Scenario: Export from the app bar

- **WHEN** a dataset is loaded and the user presses Export in the app bar
- **THEN** the Export panel opens under the button with focus on its first choice, and Escape
  closes it and returns focus to Export

#### Scenario: Nothing to export

- **WHEN** no dataset is loaded and the user focuses Export and presses Enter
- **THEN** Export keeps focus, reads as disabled, is described as "Load a dataset to export" and
  opens nothing

#### Scenario: A narrow window

- **WHEN** the window is narrower than 1200 px
- **THEN** Export and the Figure editor show only their icons, Export with a small chevron, and the
  app bar keeps one row without overflow

### Requirement: The Export panel asks what, then how

The app bar's Export button (on a phone, Export in the More sheet) SHALL open a dialog named
Export, a bottom sheet on a phone, with focus on its first choice. It SHALL first ask
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

The app bar SHALL show a Figure editor button at its right, after Export and before the divider,
the theme switch, Help, Feedback and GitHub: labelled with an image icon from 1200 px wide, the
icon alone named by its tooltip below. On a phone, upright or on its side, the More sheet's Figure editor row SHALL take its
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
