## Why

Issue #338 reports stale projections after changing a dimensionality-reduction slider. The projection key has always included every reducer parameter, so that symptom is not a parameter-cache bug; the report is reproduced instead by PCA (the first projection the app shows) taking none of those parameters, and by every Generate action downloading the same file name.

Auditing the same retained-cache flow found real staleness underneath, and it is **not** notebook-specific. Every one of these was reproduced against the CLI's own cache layout (`{output}/tmp`, one file per model name):

- A changed matrix under the same embedding name returns the earlier run's coordinates; a reordered input pairs cached coordinates with the wrong proteins; a grown input yields a projection with fewer rows than proteins.
- A disjoint FASTA embedded into the same cache returns the union of both inputs.
- A run with the other `--backend` resumes from the file the first backend wrote and returns its vectors.
- A sequence edited under an unchanged identifier keeps the vector of the previous residues.
- `prepare -q A -o out` followed by `-q B -o out` reuses A's sequences.
- Requesting annotations for identifiers a cache does not hold re-fetches every source for every identifier, which is hours at Swiss-Prot scale for one added protein.

The first iteration of this change addressed these by giving the notebook content-addressed cache directories. That hid the defects for one caller while leaving them in place for `protspace prepare`, cost a full re-read of the input on every Generate action, and discarded per-protein embedding resume whenever a single byte of the input changed.

## What Changes

- Include the embedding matrix and identifier order in the projection cache key, so cached coordinates are reused only for the data that produced them, for every caller.
- Record the producing backend, the resolved model, and a per-protein residue digest in the embedding HDF5; refuse to resume from another producer's file, and re-embed proteins whose residues changed.
- Return only the requested FASTA's proteins from an embedding load, rather than everything the shared cache accumulated.
- Address a retained query FASTA by its query text in the CLI as well as the notebook.
- Fetch each annotation source only for the identifiers the cache cannot supply, reusing cached rows for the rest, and keep a cached superset's rows when writing.
- Publish bundles, rewritten statistics/annotation tables, and retained FASTA files through one staged-rename helper that respects the process umask.
- Simplify the notebook accordingly: no content-addressed directories, no projection refetch override, and no imports that a released package may not have yet. Give each Generate action a distinguishable bundle name, and state which methods the parameter controls apply to.

## Capabilities

### New Capabilities

- `intermediate-cache-ownership`: What a retained projection, embedding, query FASTA, or annotation row is owned by, and when it may be reused.
- `atomic-file-publication`: How a published file becomes visible, and with what permissions.
- `notebook-generate-output-identity`: How a Generate action's output and parameter scope are made legible.

### Modified Capabilities

- `annotation-cache-semantics`: Reuse becomes per identifier as well as per column; the incomplete-source rules continue to apply to the identifiers being filled in.
- `embed-completeness`: Unchanged in what counts as complete; resume now additionally rejects another producer's file and re-embeds changed residues.

## Impact

- Affected code: `data/processors/pipeline.py`, `data/embedding/store.py` and both backends, `data/loaders/fasta.py`, `data/loaders/query.py`, `data/annotations/manager.py`, `cli/prepare.py`, `cli/stats.py`, `data/io/bundle.py`, `ProtSpace_Preparation.ipynb`.
- Behaviour changes for CLI users: a backend switch against an existing cache now fails with guidance instead of silently mixing vectors; projection and embedding caches recompute once where their identity was previously unproven.
- Retained caches from earlier versions stay readable: files without a producer or residue digest are adopted and stamped.
- No bundle format, no public Python API signature, and no dependency changes.
