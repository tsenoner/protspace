## MODIFIED Requirements

### Requirement: Structure viewer exposes protein resource links

When a protein is selected and the structure viewer header is shown, the system SHALL expose
AlphaFold, UniProt, InterPro, and TED as external resource links for that protein, presented as
one ordered row in which every entry carries the same label treatment, the same indication that
it leaves the application, and the same safe new-tab behavior.

The row SHALL be rendered from a single ordered definition of those destinations rather than from
per-destination markup, and the header title SHALL NOT itself be a link.

#### Scenario: The row lists every resource in order

- **WHEN** the structure viewer renders a selected protein
- **THEN** its header shows AlphaFold, UniProt, InterPro, and TED in that order
- **AND** each opens in a new tab without granting the destination access to the opener

#### Scenario: Resource links are distinguishable from the accession beside them

- **WHEN** the structure viewer header renders its resource row
- **THEN** each entry is marked as leaving the application rather than presented in the same
  treatment as the protein identifier

#### Scenario: The title is not a hidden link

- **WHEN** the structure viewer header renders its title
- **THEN** the title carries no link target, and AlphaFold is reachable from the resource row
