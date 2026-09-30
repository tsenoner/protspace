# annotation-presentation Specification

## Purpose

How annotations are surfaced to the reader: the dedicated Predicted group in the dropdown, friendly labels at every display site, the legend's marking of predicted values, and the per-annotation documentation popover.

## Requirements

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

Every annotation display site SHALL show the registry `label` for an annotation (falling back to a
prettified column name): the dropdown, the legend header, the query builder's annotation picker and
the query builder's condition button. The annotation value emitted by the dropdown and stored in a
query condition SHALL remain the raw column name. Stored values, exports, and data lookups SHALL be unaffected.
Wherever the dropdown or the query builder names an annotation, a predicted annotation SHALL carry
the same predicted badge, so two annotations that share a label remain distinguishable.

#### Scenario: Dropdown shows label but selects column name

- **WHEN** the user selects the item displayed as "EC number"
- **THEN** the dropdown emits the selection with the underlying column name `ec`

#### Scenario: Query builder picker shows labels

- **WHEN** the user opens the query builder's annotation picker for a bundle containing `cath`,
  `superfamily` and `ec`
- **THEN** the picker lists them as "CATH-Gene3D", "SUPERFAMILY" and "EC number"

#### Scenario: A condition names its annotation by label but stores the column name

- **WHEN** the user picks "CATH-Gene3D" in the query builder's annotation picker
- **THEN** the condition's annotation button reads "CATH-Gene3D"
- **AND** the condition stores the column name `cath`

#### Scenario: Annotations sharing a label stay distinguishable

- **WHEN** a bundle contains both `cc_subcellular_location` and `predicted_subcellular_location`,
  both labelled "Subcellular location"
- **THEN** the predicted one carries the predicted badge in the dropdown, in the query builder's
  annotation picker, and on the condition button once chosen

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

### Requirement: Annotation search matches only the displayed label

Every annotation picker SHALL offer an annotation for a search query exactly when the query, trimmed
and compared case-insensitively, is a substring of the label that picker displays for it. The column
name behind the label SHALL NOT be searched, so every match is on text the reader can see. A column
with no registry entry is labelled by its prettified column name and is matched through that label.
All annotation pickers SHALL apply this same rule, through one shared implementation.

#### Scenario: A column name that is not displayed does not match

- **WHEN** the reader searches for `predicted`
- **THEN** none of `predicted_membrane`, `predicted_signal_peptide`,
  `predicted_subcellular_location` and `predicted_transmembrane` is offered, because they are
  labelled "Membrane", "Signal peptide", "Subcellular location" and "Transmembrane"

#### Scenario: Letters inside a column name do not match

- **WHEN** the reader searches for `ted`
- **THEN** `ted_domains`, labelled "TED domains", is offered
- **AND** no `predicted_*` annotation is offered

#### Scenario: A partial word of a label matches

- **WHEN** the reader searches for `cellular`
- **THEN** the annotation labelled "Subcellular location" is offered

#### Scenario: An unregistered column is matched through its derived label

- **WHEN** the reader searches for `core` in a bundle with a column `my_custom_score` that has no
  registry entry
- **THEN** `my_custom_score` is offered, because its label reads "My custom score"

#### Scenario: Both pickers agree

- **WHEN** the same query is entered in the annotation dropdown and in the query builder's
  annotation picker
- **THEN** both offer the same annotations, under the same labels
