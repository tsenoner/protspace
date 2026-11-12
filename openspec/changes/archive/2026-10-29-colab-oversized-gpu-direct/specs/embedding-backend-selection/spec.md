## ADDED Requirements

### Requirement: Loading onto a GPU does not stage the model in host memory

The local backend SHALL load a checkpoint onto a CUDA GPU by placing each weight on the device as it
is read, so the whole model is never held in host memory. It SHALL expose whether loading on the
current runtime stages the model in host memory, so the Colab panel can gate on it. On the CPU, and
when the placement library is not installed, it SHALL load as before, staging the model in host
memory, without failing.

#### Scenario: A GPU runtime

- **WHEN** the local backend loads a checkpoint on a runtime with a CUDA GPU and the placement
  library installed
- **THEN** each weight is placed on the GPU as it is read, and peak host memory stays well below the
  model's size

#### Scenario: The placement library is missing

- **WHEN** the same load runs without the placement library
- **THEN** the model is built in host memory and moved to the GPU, and the load succeeds

#### Scenario: A CPU runtime

- **WHEN** the local backend loads a checkpoint without a CUDA GPU
- **THEN** loading is unchanged, and the runtime counts as staging the model in host memory

## MODIFIED Requirements

### Requirement: Oversized models are blocked only on runtimes that cannot hold them

A checkpoint declared oversized SHALL be blocked on the local backend only when loading on the
runtime stages the model in host memory and that host memory is below the threshold required to
load it, and SHALL be available otherwise. The condition SHALL be evaluated against host memory
rather than device memory, because a model staged in host memory that does not fit terminates the
runtime instead of raising a recoverable error, while a sequence that does not fit on the GPU is
skipped and reported. An installed package that does not say whether it stages the model in host
memory SHALL count as staging it.

#### Scenario: A small runtime that stages in host memory

- **WHEN** the effective backend is local, host memory is below the threshold, and loading stages
  the model in host memory (no CUDA GPU, or a package that loads through host memory)
- **THEN** the oversized checkpoint is blocked, with a remedy that does not depend on the
  Biocentral API being reachable

#### Scenario: A small runtime that loads onto the GPU

- **WHEN** the effective backend is local, host memory is below the threshold, and loading places
  the weights straight onto a CUDA GPU
- **THEN** the oversized checkpoint is available, and nothing about it is disabled

#### Scenario: A large runtime

- **WHEN** the effective backend is local and host memory is at or above the threshold
- **THEN** the oversized checkpoint is available, and nothing about it is disabled

#### Scenario: Host memory cannot be determined

- **WHEN** the host-memory probe is unavailable or fails on a runtime that stages the model in host
  memory
- **THEN** the oversized checkpoint is blocked, preferring a false block over a terminated
  runtime

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

#### Scenario: A free Colab GPU runtime

- **WHEN** the panel's effective backend is local on a free Colab runtime with a T4 GPU (12.7 GB of
  host memory, about 15 GB of GPU memory)
- **THEN** `esmc_6b` is available, and sequences up to 2,000 residues each yield a finite vector

#### Scenario: A small Colab runtime without a GPU

- **WHEN** the panel's effective backend is local, host memory is below the oversized threshold,
  and loading stages the model in host memory
- **THEN** `esmc_6b` is blocked like any other oversized checkpoint
