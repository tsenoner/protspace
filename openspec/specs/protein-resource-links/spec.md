# protein-resource-links Specification

## Purpose

The external protein databases the structure viewer header links a selected protein out to —
AlphaFold, UniProt, InterPro, and TED — and the rules every one of those destinations shares:
the row is defined in one ordered place, the URL is built from the base accession with any
version suffix stripped, the accession is URL-encoded into the path, and the link is marked as
leaving the application and opens in a new tab without granting the destination access to the
opener. Availability is the destination's to report; ProtSpace only exposes the deterministic
address.

## Requirements

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

### Requirement: TED link targets the canonical UniProt accession

The system SHALL build the TED destination as `https://ted.cathdb.info/uniprot/<accession>`, where `<accession>` is the URL-encoded base accession before any version suffix.

#### Scenario: Unversioned accession targets TED

- **WHEN** the selected protein ID is `W6JQJ9`
- **THEN** the TED link target is `https://ted.cathdb.info/uniprot/W6JQJ9`

#### Scenario: Versioned accession targets its base entry

- **WHEN** the selected protein ID is `W6JQJ9.2`
- **THEN** the TED link target is `https://ted.cathdb.info/uniprot/W6JQJ9`

#### Scenario: Accession is safely encoded

- **WHEN** a protein ID contains characters that are not safe in a URL path segment
- **THEN** the base accession is URL-encoded in the TED link target
