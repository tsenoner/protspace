## ADDED Requirements

### Requirement: Structure viewer exposes protein resource links

When a protein is selected and the structure viewer header is shown, the system SHALL expose UniProt, InterPro, and TED as external resource links for that protein.

#### Scenario: TED link is shown with existing protein resources

- **WHEN** the structure viewer renders a selected protein
- **THEN** its header shows a link named `TED` beside the UniProt and InterPro links
- **AND** the TED link opens in a new tab without granting the destination access to the opener

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
