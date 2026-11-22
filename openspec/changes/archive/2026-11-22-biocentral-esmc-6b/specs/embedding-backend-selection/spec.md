## MODIFIED Requirements

### Requirement: The compatibility rules do not constrain the CLI

The CLI SHALL accept an oversized checkpoint on the local backend, because that rule describes a
hosted notebook environment rather than the package. The package MAY warn about a checkpoint's
size, but SHALL NOT refuse the combination.

#### Scenario: Oversized checkpoint on real hardware

- **WHEN** `protspace prepare --backend local` is invoked with an oversized checkpoint
- **THEN** it runs, optionally emitting a warning about the memory it needs

#### Scenario: The blocked sets stay declarative

- **WHEN** the package exposes which checkpoints are oversized
- **THEN** it exposes the set alone, without asserting what any particular runtime can hold

### Requirement: Biocentral serves ESM-C from the official checkpoints

The Biocentral backend SHALL request `esmc_300m`, `esmc_600m` and `esmc_6b` under the official
ESM-C checkpoint ids, the same checkpoints the local backend loads, so either backend yields the
same vectors for the same sequence. A scheduled check against the live server SHALL compare an
embedding from each of the three with a reference computed from the official weights, so a server
that answers with another model fails the check instead of passing it.

#### Scenario: ESM-C requested through Biocentral

- **WHEN** the effective backend is the Biocentral API and an `esmc_*` shortcut is selected
- **THEN** it is available, and the request names the official checkpoint

#### Scenario: Both backends agree

- **WHEN** the same sequence is embedded with an `esmc_*` shortcut on each backend
- **THEN** the two vectors agree to a cosine above 0.999

#### Scenario: The server answers with another model

- **WHEN** the live check's vector for any ESM-C size does not match its reference
- **THEN** the check fails

## ADDED Requirements

### Requirement: Both backends serve every embedder shortcut

Every embedder shortcut the CLI offers SHALL be served by both the local backend and the Biocentral
API, so neither the CLI nor the Colab panel refuses a shortcut because of the backend it runs on.

#### Scenario: The registries agree

- **WHEN** the embedder registries are compared
- **THEN** the CLI's shortcut list equals the local backend's and the Biocentral backend's

#### Scenario: The panel on the Biocentral backend

- **WHEN** the panel's effective backend is the Biocentral API
- **THEN** no embedder is disabled for that backend

## REMOVED Requirements

### Requirement: A local-only embedder is refused on the Biocentral backend

**Reason**: Biocentral v2.1.0 computes `esmc_6b`, the only embedder that was local-only, so the
refusal has nothing left to refuse.

**Migration**: None. `--backend biocentral` now accepts every shortcut.
