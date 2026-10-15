# ted-domain-annotations Specification

## Purpose

How ProtSpace serializes the structural domains it retrieves from TED (The Encyclopedia of
Domains) into the `ted_domains` annotation: what a domain with no CATH assignment is labelled,
how multiple domains are joined, and how an annotation cache written by an older version is
brought up to date.

## Requirements

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

- **WHEN** ProtSpace reads an annotation cache whose `ted_domains` values include a domain labeled
  `unclassified`
- **THEN** ProtSpace rewrites each such domain to `-`, retaining its pLDDT score, and persists the
  repaired cache so no refetch is required

#### Scenario: Only some annotations are missing from the cache

- **WHEN** ProtSpace fetches a missing annotation source but reuses the cached `ted_domains` column
- **THEN** the reused column is already repaired, so the legacy label cannot reach the output

#### Scenario: A CATH name contains the legacy word

- **WHEN** a cached `ted_domains` value contains `unclassified` inside a resolved CATH name rather
  than as a whole domain label
- **THEN** ProtSpace leaves that value unchanged
