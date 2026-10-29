## MODIFIED Requirements

### Requirement: Generic no-match feedback remains available

The protein search SHALL show generic no-match feedback only while a non-empty query being typed
matches no available protein ID at all. Once the query is submitted with Enter, the report for an
unknown ID SHALL take its place.

#### Scenario: Query matches nothing

- **WHEN** a non-empty query prefix-matches no available protein ID
- **THEN** the search feedback displays `No matching protein IDs found`

#### Scenario: No-match feedback is a rendered popup

- **WHEN** the no-match feedback is displayed
- **THEN** the input reports `aria-expanded` as true and `aria-controls` names the rendered popup
- **AND** the message is announced to assistive technology

#### Scenario: Submitting a query that matches nothing

- **WHEN** the user presses Enter on a query that matches no available protein ID
- **THEN** the no-match feedback gives way to the report "No protein <query> in this dataset"

## ADDED Requirements

### Requirement: An unknown ID is reported by name

When the user submits an ID with Enter that the dataset does not hold, the search SHALL report
"No protein <ID> in this dataset" in its popup, announce it, keep the typed text and change no
selection. When the submitted ID is already selected it SHALL report "<ID> is already selected".
Escape SHALL first close the report, keeping the text, and then empty the field; typing SHALL also
close the report.

#### Scenario: An unknown ID

- **WHEN** the user types `NOT_A_PROTEIN_ZZZ` and presses Enter
- **THEN** the report and the announcement read "No protein NOT_A_PROTEIN_ZZZ in this dataset", the
  field keeps the text, and nothing is selected

#### Scenario: Escape after a report

- **WHEN** the report is shown and the user presses Escape twice
- **THEN** the first Escape closes the report and keeps the text, and the second empties the field

### Requirement: A pasted list reports what was found and what was not

Pasting several IDs (separated by commas, semicolons, spaces or new lines, in any letter case) SHALL
select every ID the dataset holds and, when any is missing or already selected, report
"<found> of <total> found" with a "Not found" list of at most 50 missing IDs followed by "and N
more", and a "Copy missing IDs" button that copies every missing ID, one per line. The button SHALL
read "Copied", or "Could not copy" when the clipboard refuses, for a moment, and the report SHALL
stay. The announcement SHALL be the headline plus the missing count ("2 of 4 found, 2 not found"),
never the list. A paste whose IDs are all found and new SHALL show no report.

#### Scenario: Two of four found

- **WHEN** the user pastes two known IDs and two unknown ones
- **THEN** the two known proteins are selected, the report reads "2 of 4 found" and lists the two
  unknown IDs, and the announcement reads "2 of 4 found, 2 not found"

#### Scenario: Copying the missing IDs

- **WHEN** the user presses Copy missing IDs
- **THEN** the clipboard holds the missing IDs one per line, the button reads "Copied", and the
  report stays on screen

#### Scenario: A long list of missing IDs

- **WHEN** more than 50 pasted IDs are missing
- **THEN** the report lists 50 of them and says how many more there are, and Copy takes them all

### Requirement: One hit is brought into view; several are selected in place

A single protein found with Enter SHALL be selected, centred in the plot and zoomed in on. A pasted
list SHALL be selected without moving the view, and the selection bar's "Zoom to them" SHALL then
bring the selection into view.

#### Scenario: A single hit

- **WHEN** the user types a known ID and presses Enter
- **THEN** the protein is selected, the view zooms in at least eightfold, and the protein sits at
  the plot's centre to within 2 px

#### Scenario: A pasted list

- **WHEN** the user pastes three known IDs
- **THEN** the three proteins are selected, the view does not move, and no report is shown
- **AND** "Zoom to them" in the selection bar then changes the view

### Requirement: A hit the current view hides is still selected

When a found protein is hidden in the current view, for example by a filter, the search SHALL
still select it, SHALL NOT move the view, and SHALL report "<ID> is selected but hidden in
this view".

#### Scenario: A protein the filter hides

- **WHEN** a filter is applied and the user submits the ID of a protein it hides
- **THEN** the protein is selected, the view does not move, and the report reads "<ID> is selected
  but hidden in this view"
