# embedding-backend-selection Specification

## Purpose

Which backend computes embeddings — this runtime's own GPU or the remote Biocentral API — how that choice is resolved when it is left to `auto`, and which embedders each backend may actually serve. Two rules constrain the pairing: Biocentral accepts `esmc_*` but returns embeddings orthogonal to the real model, and an oversized checkpoint cannot load on a small runtime. Both describe the hosted notebook environment rather than the package, so they are declared centrally, enforced in the Colab panel, and deliberately left unenforced by the CLI, where the same combinations are correct on real hardware.

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

### Requirement: ESM-C is blocked on the Biocentral backend

The `esmc_300m` and `esmc_600m` shortcuts SHALL be blocked when the effective backend is
the Biocentral API, because that API returns embeddings orthogonal to the real model — its
engine has no dedicated ESM-C embedder and substring-matches the checkpoint into a vanilla
ESM-2 architecture. The remedy offered SHALL be the local backend, which serves ESM-C
correctly.

#### Scenario: ESM-C requested through Biocentral

- **WHEN** the effective backend is the Biocentral API and an `esmc_*` shortcut is selected
- **THEN** it is blocked, and the local backend is named as the way to obtain it

#### Scenario: ESM-C on the local backend

- **WHEN** the effective backend is local
- **THEN** `esmc_*` shortcuts are available

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

The CLI SHALL accept both an oversized checkpoint on the local backend and an `esmc_*`
shortcut on either backend, because both rules describe a hosted notebook environment
rather than the package. The package MAY warn about a checkpoint's size, but SHALL NOT
refuse the combination.

#### Scenario: Oversized checkpoint on real hardware

- **WHEN** `protspace prepare --backend local` is invoked with an oversized checkpoint
- **THEN** it runs, optionally emitting a warning about the memory it needs

#### Scenario: The blocked sets stay declarative

- **WHEN** the package exposes which checkpoints are oversized
- **THEN** it exposes the set alone, without asserting what any particular runtime can hold
