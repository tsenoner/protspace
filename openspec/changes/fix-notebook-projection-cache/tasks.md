## 1. Regression coverage

- [x] 1.1 Integrate the same-name changed-embedding projection regression into the normal pipeline suite and construct `ReductionPipeline` through its initializer.
- [x] 1.2 Add focused regressions for query changes, disjoint FASTA inputs, same-ID sequence changes, and annotation identifier mismatches.
- [x] 1.3 Run the new cache-identity regressions before implementation and record the expected failures.
- [x] 1.4 Add RED regressions for Local/Biocentral cache ownership, same-backend reuse, and interrupted query FASTA publication.
- [x] 1.5 Add RED regressions for annotation-cache superset reuse and published FASTA permissions.

## 2. Notebook implementation

- [x] 2.1 Configure `ProtSpace_Preparation.ipynb` to explicitly refresh only the projection stage on every Generate action.
- [x] 2.2 Partition cached query FASTA files by query text.
- [x] 2.3 Partition retained embedding, annotation, and projection intermediates by selected input-file content.
- [x] 2.4 Validate cached annotation identifiers before reuse and preserve incremental reuse for matching inputs.
- [x] 2.5 Scope embedding H5 paths by producing backend while retaining same-backend/model reuse.
- [x] 2.6 Stage, validate, and atomically publish query FASTA cache files, cleaning incomplete artifacts.
- [x] 2.7 Preserve normal umask-derived permissions when atomically publishing query FASTA files.
- [x] 2.8 Reuse annotation caches that cover all requested identifiers without truncating cached supersets.

## 3. Focused verification

- [x] 3.1 Run the regression after implementation and observe it pass.
- [x] 3.2 Validate the notebook with `nbformat` and compile every code cell after removing Colab magics.
- [x] 3.3 Verify the original two-run reproduction returns coordinates from the changed input and invokes the reducer twice.
- [x] 3.4 Run the consolidated pipeline regressions and the full non-slow Python suite.
- [x] 3.5 Make notebook projection-refetch wiring failures explicit in the focused regression.

## 4. Repository gates

- [x] 4.1 Run affected Python tests and Ruff checks.
- [x] 4.2 Run `openspec validate fix-notebook-projection-cache --strict`.
- [x] 4.3 Run `pnpm precommit` before commit and push.

## 5. Review follow-ups

- [x] 5.1 Guard the notebook's cache-helper import with fallbacks for the released-package lag, pinned against the package by a test.
- [x] 5.2 Align multi-embedder sets to their shared identifiers before annotating and bundling in the notebook.
- [x] 5.3 Let a rebuild for missing identifiers replace the rejected annotation cache when a source is incomplete.
- [x] 5.4 Stream query FASTA extraction once instead of decompressing and parsing it three times.
- [x] 5.5 Parse each shared FASTA once when extracting sequences for several embedding sets.
