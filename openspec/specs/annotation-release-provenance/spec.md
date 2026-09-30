# annotation-release-provenance Specification

## Purpose

TBD - created by archiving change annotation-retrieval-robustness. Update Purpose after archive.

## Requirements

### Requirement: The annotation cache records the UniProt release of its UniProt values

The annotation cache SHALL record which UniProtKB release or releases its UniProt-derived values
came from. The value is taken from the `X-UniProt-Release` header of the UniProt responses the
retrieval already receives, and no extra request is made. Staged runs serve UniProt from the
cache in every stage after the first, so a release that is not stored with the values is lost by
the time the final bundle is built.

#### Scenario: UniProt is fetched for every protein

- **WHEN** a run fetches UniProt annotations for every requested protein and the responses carry
  `X-UniProt-Release: 2026_03`
- **THEN** the cache it writes records `2026_03`

#### Scenario: Proteins are added to a cache from an earlier release

- **WHEN** a cache recording `2026_02` is filled in for added proteins whose UniProt responses
  carry `2026_03`
- **THEN** the rewritten cache records both `2026_02` and `2026_03`

#### Scenario: UniProt is refetched

- **WHEN** a run refetches UniProt for every requested protein, through `--refetch` or a legacy
  cache refresh
- **THEN** the cache records only the releases seen in that refetch

#### Scenario: A cache predates release recording

- **WHEN** a cache written before this requirement is reused or filled in
- **THEN** its contribution is recorded as `unknown` rather than guessed

#### Scenario: The responses carry no release header

- **WHEN** no UniProt response in a run carries the header
- **THEN** no release is recorded for that run's values, and they read as `unknown` later

#### Scenario: No identifier is a UniProt accession

- **WHEN** a run writes a cache for identifiers none of which is a UniProt accession, so no
  UniProt request is made
- **THEN** the cache records that none of its values came from UniProt, rather than `unknown`

### Requirement: The run log states the UniProt release of the run's annotations

`protspace prepare` SHALL write a `uniprot_release:` line in the `## Annotations` section of
`run.log`, stating the UniProtKB release or releases the run's annotations came from, whether
they were fetched in this run or read from the annotation cache. The same data re-fetched a
release later can differ, so a log without the release cannot tie a bundle's numbers to the
data behind them.

#### Scenario: Annotations were fetched in this run

- **WHEN** a run fetches UniProt annotations whose responses carry `2026_03`
- **THEN** `run.log` contains `uniprot_release: 2026_03`

#### Scenario: Annotations were served from the cache

- **WHEN** a run serves every annotation from a cache that records `2026_03`
- **THEN** `run.log` contains `uniprot_release: 2026_03` even though no UniProt request was made

#### Scenario: Several releases contributed

- **WHEN** the run's UniProt values came from more than one release
- **THEN** the line lists each release, sorted and separated by `, `

#### Scenario: The release cannot be known

- **WHEN** UniProt values were used but no release is known for some of them
- **THEN** the line includes `unknown`

#### Scenario: No UniProt data was used

- **WHEN** a run's annotations come only from a user-supplied CSV
- **THEN** `run.log` contains `uniprot_release: none`

#### Scenario: No identifier is a UniProt accession

- **WHEN** a run's identifiers include no UniProt accession, as with a FASTA of custom
  identifiers
- **THEN** `run.log` contains `uniprot_release: none`, both for the run that fetched the
  annotations and for a later run served from its cache
