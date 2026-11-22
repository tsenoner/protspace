## MODIFIED Requirements

### Requirement: The compatibility rules do not constrain the CLI

The CLI SHALL accept an oversized checkpoint on the local backend, because that rule describes a
hosted notebook environment rather than the package. The package MAY warn about a checkpoint's
size, but SHALL NOT refuse the combination. An embedder the Biocentral backend does not serve at
all is not such a rule, and the CLI refuses it there.

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

### Requirement: A local-only embedder is refused on the Biocentral backend

An embedder that only the local backend serves SHALL be refused when the effective backend is the
Biocentral API. The CLI SHALL reject it as a usage error that names the local backend as the
remedy, before any input is fetched or any request is sent, and the Colab panel SHALL disable it
for that backend. Every embedder the Biocentral backend serves SHALL also be served by the local
backend. Today no embedder is local-only.

#### Scenario: A local-only embedder on the Biocentral backend

- **WHEN** `protspace prepare` or `protspace embed` runs with `--backend biocentral` and a
  local-only embedder
- **THEN** it exits with a usage error naming `--backend local`, before fetching sequences or
  contacting the server

#### Scenario: The panel on the Biocentral backend

- **WHEN** the panel's effective backend is the Biocentral API and the installed release lists an
  embedder as local-only
- **THEN** that embedder is disabled, with the reason and the remedy shown

#### Scenario: Every Biocentral shortcut runs locally

- **WHEN** the embedder registries are compared
- **THEN** the CLI's shortcut list equals the local backend's, and without the local-only
  shortcuts it equals the Biocentral backend's
