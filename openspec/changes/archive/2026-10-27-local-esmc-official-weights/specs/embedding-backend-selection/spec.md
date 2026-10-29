## ADDED Requirements

### Requirement: The local backend serves ESM-C from the official checkpoints

The local backend SHALL load `esmc_300m` and `esmc_600m` from the official ESM-C checkpoints
through the `transformers` library's own model implementation, without executing modeling code
downloaded from the checkpoint repository. The per-protein vectors it produces SHALL match those
of the reimplementation it replaces to within float32 precision, so an embedding file written by
an earlier local run remains owned by the same producer and resumes without being refetched.

#### Scenario: Loading ESM-C locally

- **WHEN** `protspace embed --backend local -e esmc_300m` runs
- **THEN** the model loads from the official ESM-C repository with no remote code, and each
  sequence yields one 960-dimensional vector (1152 for `esmc_600m`)

#### Scenario: Resuming an earlier ESM-C file

- **WHEN** a local run resumes from an `.h5` that an earlier local `esmc_*` run wrote
- **THEN** the file is accepted as the same producer, and only the missing proteins are embedded

#### Scenario: Installing the local extra

- **WHEN** the `local` extra is installed
- **THEN** the resolved `transformers` release includes the native ESM-C model
