## ADDED Requirements

### Requirement: Dedicated "Predicted" group in the annotation dropdown

The annotation selection dropdown SHALL present predicted annotations in a dedicated "Predicted"
group, derived from the annotation-metadata registry, shown as the first group ahead of the
source-based groups (UniProt, InterPro, Taxonomy, Other). Predicted items SHALL appear in the
Predicted group regardless of their original source, and SHALL NOT be duplicated in a source group.
Existing search, keyboard navigation, and tooltip-toggle behavior SHALL continue to work across the
new grouping.

#### Scenario: Predicted annotations are grouped together

- **WHEN** the dropdown is opened for a bundle containing predicted and experimental annotations
- **THEN** a "Predicted" group lists the predicted annotations first, and experimental annotations
  appear under their source groups below

#### Scenario: Search and keyboard navigation span the new group

- **WHEN** the user filters or arrow-key-navigates the dropdown
- **THEN** items in the Predicted group are included in the filtered results and navigation order

### Requirement: Friendly annotation labels at display sites

The dropdown and legend header SHALL display the registry `label` for an annotation (falling back
to a prettified column name), while the selected annotation value emitted by the dropdown SHALL
remain the raw column name. Stored values, exports, and data lookups SHALL be unaffected.

#### Scenario: Dropdown shows label but selects column name

- **WHEN** the user selects the item displayed as "EC number"
- **THEN** the dropdown emits the selection with the underlying column name `ec`

### Requirement: Legend marks predicted annotations

When the active coloring annotation is predicted, the legend header SHALL display a compact
`⚡ Predicted` badge together with a short note indicating the values come from a model rather than
curation. When the active annotation is experimental, no such badge or note SHALL be shown.

#### Scenario: Predicted annotation active

- **WHEN** `predicted_membrane` is the active coloring annotation
- **THEN** the legend header shows a `⚡ Predicted` badge and a note that the values are predicted

#### Scenario: Experimental annotation active

- **WHEN** `ec` is the active coloring annotation
- **THEN** the legend header shows no predicted badge or note

### Requirement: Documentation popover for annotations

Where annotation metadata includes a non-empty description and/or a `docsUrl`, the UI SHALL offer
an information control (an info icon) that opens a popover containing the description and, when
present, a "Learn more" link to the documentation page. The control SHALL be available in the
dropdown (per annotation) and in the legend header (for the active annotation), SHALL be keyboard
accessible and dismissable, and SHALL be absent when there is no description and no `docsUrl`.

#### Scenario: Viewing an annotation description

- **WHEN** the user activates the info icon for an annotation that has a description
- **THEN** a popover appears showing the description and, if a `docsUrl` exists, a "Learn more" link

#### Scenario: No documentation available

- **WHEN** an annotation has no description and no `docsUrl` (e.g. an unknown custom column)
- **THEN** no info icon is shown for it

#### Scenario: Popover is dismissable

- **WHEN** a documentation popover is open and the user presses Escape or clicks outside it
- **THEN** the popover closes
