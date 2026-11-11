## MODIFIED Requirements

### Requirement: Legend marks predicted annotations

When the active coloring annotation is predicted, the legend header SHALL show a PRED text badge
after its title, exposed to assistive technology as an image named "Predicted annotation", whose
tooltip reads "Predicted: computational, not experimentally curated". The same badge and tooltip
SHALL mark a predicted annotation wherever the Color by menu or the query builder names it. The
header SHALL show no other badge or note for it. When the active annotation is experimental, no
such mark or tooltip SHALL be shown.

#### Scenario: Predicted annotation active

- **WHEN** `predicted_membrane` is the active coloring annotation
- **THEN** the legend header shows the PRED badge named "Predicted annotation", whose tooltip
  reads "Predicted: computational, not experimentally curated"

#### Scenario: Experimental annotation active

- **WHEN** `ec` is the active coloring annotation
- **THEN** the legend header shows no predicted mark or tooltip

## ADDED Requirements

### Requirement: TED domains without a CATH label SHALL be named in words

The web app SHALL show the TED domains value `-`, TED's mark for a domain it found but could not
assign a CATH superfamily, as "No CATH label" in the legend rows, the Other popover, the colour
picker, the protein tooltip, the filter's value list and chips, status announcements, and the
legends of image exports and the figure editor. The underlying value SHALL stay `-`, so the plot,
filters, saved settings and bundles keep matching it, and searching the Other popover or the filter
value list SHALL find it by either spelling. A protein with no TED domains at all SHALL still read
N/A. Another annotation's `-` SHALL be shown as written.

#### Scenario: The legend names the unlabelled domain

- **WHEN** the user colours by TED domains and some proteins carry the value `-`
- **THEN** their legend row reads "No CATH label", and proteins without TED data read N/A

#### Scenario: The tooltip names it

- **WHEN** the user hovers a protein whose TED domains include `-`
- **THEN** the tooltip lists that domain as "No CATH label"

#### Scenario: Filtering still matches the value

- **WHEN** the user types `cath` or `-` into the TED domains value list of a filter condition
- **THEN** "No CATH label" is offered, and choosing it keeps the proteins whose value is `-`
