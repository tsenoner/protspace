# embedding-backend-selection Specification

## Purpose

Which backend computes embeddings — this runtime's own GPU or the remote Biocentral API — how that choice is resolved when it is left to `auto`, and which embedders each backend may actually serve. The pairing is constrained by per-backend blocked sets: today only the local one has a member (an oversized checkpoint cannot load on a small runtime), while the Biocentral set is empty since Biocentral serves ESM-C from the official checkpoints, and is kept so a release can block a shortcut that server answers wrongly. Such rules describe the hosted notebook environment rather than the package, so they are declared centrally, enforced in the Colab panel, and deliberately left unenforced by the CLI, where the same combinations are correct on real hardware.

## Requirements

### Requirement: Auto resolves to the local backend only on a Colab GPU runtime

The `auto` backend selection SHALL resolve to the local backend only when the process is
running inside a Google Colab runtime that also has CUDA available, and SHALL resolve to
the Biocentral API otherwise. A missing or non-importable `torch`, or any failure of the
CUDA probe, SHALL be treated as "no GPU" rather than propagating an error.

#### Scenario: Colab runtime with a GPU attached

- **WHEN** `auto` is resolved inside a Colab runtime with CUDA available
- **THEN** the effective backend is the local one, and no request leaves the runtime

#### Scenario: Colab runtime without a GPU

- **WHEN** `auto` is resolved inside a Colab runtime with no CUDA device
- **THEN** the effective backend is the Biocentral API

#### Scenario: The CUDA probe fails

- **WHEN** `torch` is absent or the CUDA probe raises
- **THEN** the effective backend is the Biocentral API, and no exception reaches the caller

### Requirement: A fallback away from the local backend is disclosed with its remedy

The notebook panel SHALL state the effective backend whenever `auto` resolves to something
other than what the runtime could provide locally, and SHALL name the action that changes
it. A resolution to the Biocentral API caused by an absent GPU SHALL NOT be silent, because
the documented route into this notebook is a Biocentral outage — leaving the fallback
undisclosed hands the user back to the service that just failed.

#### Scenario: Auto falls back on a GPU-less runtime

- **WHEN** `auto` resolves to the Biocentral API because no GPU is attached
- **THEN** the panel shows that the effective backend is Biocentral, and tells the user to
  attach a GPU runtime to use this runtime's own hardware instead

#### Scenario: Arriving from a Biocentral outage

- **WHEN** a user opens the notebook from the Biocentral-unavailable route and does not
  attach a GPU
- **THEN** the panel's disclosure is sufficient to explain why the run would still depend
  on Biocentral

### Requirement: Embedders a backend cannot serve are blocked before work is paid for

The panel SHALL disable an embedder that the effective backend cannot serve, and SHALL also
reject such a selection at generation time as a backstop. Both SHALL be driven by one
declaration, so the enabled set and the accepted set cannot disagree. Rejection SHALL occur
before any expensive input acquisition, so an incompatible selection does not first pay for
a UniProt download.

#### Scenario: Selecting an unavailable embedder

- **WHEN** the effective backend cannot serve an embedder
- **THEN** that embedder's control is disabled, with the reason and a remedy shown

#### Scenario: An incompatible selection reaches generation

- **WHEN** generation starts with an embedder the effective backend cannot serve
- **THEN** it is dropped with a message naming the embedder, the reason and the remedy,
  before any sequences are fetched

#### Scenario: Every blocked name is a real embedder

- **WHEN** the blocked sets are compared against the embedder registry
- **THEN** every blocked name resolves to a known shortcut, so no rule silently gates
  nothing

### Requirement: Oversized models are blocked only on runtimes that cannot hold them

A checkpoint declared oversized SHALL be blocked on the local backend only when the
runtime's host memory is below the threshold required to load it, and SHALL be available
otherwise. The condition SHALL be evaluated against host memory rather than device memory,
because such a checkpoint is materialised on the host before it reaches the accelerator,
and that failure terminates the runtime instead of raising a recoverable error.

#### Scenario: A small runtime

- **WHEN** the effective backend is local and host memory is below the threshold
- **THEN** the oversized checkpoint is blocked, with a remedy that does not depend on the
  Biocentral API being reachable

#### Scenario: A large runtime

- **WHEN** the effective backend is local and host memory is at or above the threshold
- **THEN** the oversized checkpoint is available, and nothing about it is disabled

#### Scenario: Host memory cannot be determined

- **WHEN** the host-memory probe is unavailable or fails
- **THEN** the oversized checkpoint is blocked, preferring a false block over a terminated
  runtime

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

### Requirement: Embedding options apply only to runs that embed

`prepare` SHALL build an embedding configuration only when it embeds sequences (FASTA input or
`-q/--query`). When it embeds nothing, a `-b/--backend`, `--batch-size` or `--max-length` given on
the command line SHALL produce a warning that the option has no effect, and SHALL NOT fail the run.

#### Scenario: HDF5 input with -b local

- **WHEN** `prepare -i emb.h5 -b local` is run
- **THEN** the run completes and a warning says `-b/--backend` only applies when sequences are
  embedded

#### Scenario: HDF5 input with --max-length

- **WHEN** `prepare -i emb.h5 --max-length 1000` is run with the default backend
- **THEN** the run completes with a warning instead of the local-backend-only error

#### Scenario: Defaults do not warn

- **WHEN** `prepare -i emb.h5` is run without embedding options
- **THEN** no embedding-option warning is given

### Requirement: A run that embeds nothing imports no embedding backend

A `prepare` run that embeds nothing SHALL NOT import `protspace.data.embedding`, `biocentral_api`
or `torch`.

#### Scenario: HDF5-only prepare

- **WHEN** `prepare -i emb.h5 -a labels.csv -m pca2` runs in a fresh interpreter
- **THEN** none of `protspace.data.embedding`, `biocentral_api` and `torch` is in `sys.modules`
  afterwards

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

### Requirement: Biocentral serves ESM-C from the official checkpoints

The Biocentral backend SHALL request `esmc_300m` and `esmc_600m` under the official ESM-C
checkpoint ids, the same checkpoints the local backend loads, so either backend yields the same
vectors for the same sequence. A scheduled check against the live server SHALL compare an ESM-C
embedding with a reference computed from the official weights, so a server that answers with
another model fails the check instead of passing it.

#### Scenario: ESM-C requested through Biocentral

- **WHEN** the effective backend is the Biocentral API and an `esmc_*` shortcut is selected
- **THEN** it is available, and the request names the official checkpoint

#### Scenario: Both backends agree

- **WHEN** the same sequence is embedded with `esmc_300m` on each backend
- **THEN** the two vectors agree to within float32 precision

#### Scenario: The server answers with another model

- **WHEN** the live check's ESM-C vector does not match the reference
- **THEN** the check fails

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
