## ADDED Requirements

### Requirement: Preserve the TED label for domains without a CATH assignment

ProtSpace SHALL serialize a TED domain whose CATH label is missing or `-` with the label `-` and
SHALL retain that domain's pLDDT score.

#### Scenario: TED returns an unlabeled domain

- **WHEN** a TED domain has `cath_label: "-"` and pLDDT `90.5`
- **THEN** ProtSpace serializes that domain as `-|90.5`

#### Scenario: An unlabeled domain appears with labeled domains

- **WHEN** a TED response contains both CATH-labeled and unlabeled domains
- **THEN** ProtSpace retains all domains in their source order, separates them with semicolons, and
  represents each unlabeled domain with `-` rather than `unclassified`

#### Scenario: A reused cache contains the legacy TED label

- **WHEN** ProtSpace reuses an annotation cache whose `ted_domains` values include a domain labeled
  `unclassified`
- **THEN** ProtSpace warns that `--refetch ted` is required to refresh those stored values
