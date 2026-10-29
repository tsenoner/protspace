## ADDED Requirements

### Requirement: A local-only embedder is refused on the Biocentral backend

An embedder that only the local backend serves SHALL be refused when the effective backend is the
Biocentral API. The CLI SHALL reject it as a usage error that names the local backend as the
remedy, before any input is fetched or any request is sent, and the Colab panel SHALL disable it
for that backend. Every embedder the Biocentral backend serves SHALL also be served by the local
backend.

#### Scenario: A local-only embedder on the Biocentral backend

- **WHEN** `protspace prepare` or `protspace embed` runs with `--backend biocentral -e esmc_6b`
- **THEN** it exits with a usage error naming `--backend local`, before fetching sequences or
  contacting the server

#### Scenario: The panel on the Biocentral backend

- **WHEN** the panel's effective backend is the Biocentral API
- **THEN** `esmc_6b` is disabled, with the reason and the remedy shown

#### Scenario: Every Biocentral shortcut runs locally

- **WHEN** the embedder registries are compared
- **THEN** the CLI's shortcut list equals the local backend's, and without the local-only
  shortcuts it equals the Biocentral backend's

### Requirement: The local backend serves ESM-C 6B in half precision on a GPU

The local backend SHALL load `esmc_6b` from the official `biohub/ESMC-6B` checkpoint through the
`transformers` library's own model implementation. It SHALL load the weights in bfloat16 on a GPU
that supports it, in float16 on any other GPU, and in float32 on the CPU. Each sequence SHALL yield
one finite 2560-dimensional float32 vector.

#### Scenario: Embedding on a GPU

- **WHEN** `protspace embed --backend local -e esmc_6b` runs on a CUDA device
- **THEN** the model is loaded in half precision with no remote code, and each sequence yields one
  finite 2560-dimensional vector

#### Scenario: Embedding on the CPU

- **WHEN** the same command runs without a CUDA device
- **THEN** the model is loaded in float32

#### Scenario: A small Colab runtime

- **WHEN** the panel's effective backend is local and host memory is below the oversized
  threshold
- **THEN** `esmc_6b` is blocked like any other oversized checkpoint

## MODIFIED Requirements

### Requirement: The compatibility rules do not constrain the CLI

The CLI SHALL accept both an oversized checkpoint on the local backend and the `esmc_300m` and
`esmc_600m` shortcuts on either backend, because both rules describe a hosted notebook environment
rather than the package. The package MAY warn about a checkpoint's size, but SHALL NOT refuse the
combination. An embedder the Biocentral backend does not serve at all is not such a rule, and the
CLI refuses it there.

#### Scenario: Oversized checkpoint on real hardware

- **WHEN** `protspace prepare --backend local` is invoked with an oversized checkpoint
- **THEN** it runs, optionally emitting a warning about the memory it needs

#### Scenario: The blocked sets stay declarative

- **WHEN** the package exposes which checkpoints are oversized
- **THEN** it exposes the set alone, without asserting what any particular runtime can hold
