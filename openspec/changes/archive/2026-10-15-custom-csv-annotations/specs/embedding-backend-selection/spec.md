## ADDED Requirements

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
