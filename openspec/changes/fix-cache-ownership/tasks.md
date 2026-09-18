## 1. Earlier iteration (notebook-scoped, already on the branch)

- [x] 1.1 Atomic, query-addressed retained FASTA publication with umask-derived permissions.
- [x] 1.2 Annotation-cache identifier validation before reuse.
- [x] 1.3 Align embedding sets with `_validate_headers` in the notebook Generate path.
- [x] 1.4 Consolidated cache regressions in the normal pipeline suite.

## 2. Projection identity

- [x] 2.1 Add a failing regression for a changed matrix, a reordered input, and a grown input under one embedding name.
- [x] 2.2 Fingerprint each embedding set once per run and include it in the projection cache key, covering the precomputed-MDS branch.
- [x] 2.3 Drop `refetch_stages={"projections"}` from the notebook and pin that a repeated identical run is a cache hit.

## 3. Embedding identity

- [x] 3.1 Add failing regressions for a cross-backend resume, a changed sequence under an unchanged identifier, a legacy unstamped file, and a disjoint FASTA reusing one cache.
- [x] 3.2 Record `protspace_backend` / `protspace_model` root attributes and the per-protein residue digest in the shared store.
- [x] 3.3 Refuse to resume from another producer's file, naming the remedies; adopt and stamp an unstamped file.
- [x] 3.4 Re-embed proteins whose residues no longer match their digest.
- [x] 3.5 Return only the requested FASTA's proteins from `embed_fasta`.

## 4. Query FASTA identity

- [x] 4.1 Add a failing regression for `-q A` then `-q B` sharing one output directory.
- [x] 4.2 Address the retained FASTA by query text in `cli/prepare.py`, and keep the notebook's path inline.

## 5. Annotation identity

- [x] 5.1 Add failing regressions for a partially covering cache, taxonomy reuse by organism, a superset cache surviving a fetch, and a source failing while filling in.
- [x] 5.2 Fetch each cached source only for the identifiers the cache lacks, merging with cached rows.
- [x] 5.3 Fill in taxonomy only for organisms the cached lookup does not cover.
- [x] 5.4 Keep rows outside the current run when the run's columns match the cache's.
- [x] 5.5 Remove the pipeline's full-rebuild path now that the manager fills in per identifier.

## 6. Atomic publication

- [x] 6.1 Add a failing regression for bundle permissions under a permissive umask.
- [x] 6.2 Add `data/io/atomic.py` and route the bundle writer, the `stats` rewrites, and the retained FASTA through it.

## 7. Notebook and issue #338

- [x] 7.1 Remove the content-addressed directories, the private imports and their fallbacks, keeping the backend-prefixed HDF5 name and the query-addressed FASTA path inline.
- [x] 7.2 Name each Generate action's bundle distinctly and report the name.
- [x] 7.3 State which methods the parameter controls apply to.

## 8. Documentation and gates

- [x] 8.1 Update `docs/guide/fetching-and-caching.md` and `docs/guide/python-cli.md` for per-identifier annotation reuse, projection identity, producer ownership, and the query-addressed FASTA.
- [x] 8.2 Update the test table and the caching notes in `apps/protspace/CLAUDE.md`.
- [x] 8.3 Open the follow-up issue for anything deliberately left out, and link it from the PR.
- [ ] 8.4 Run the non-slow Python suite, Ruff, `openspec validate fix-cache-ownership --strict`, and `pnpm precommit`.
- [x] 8.5 Re-run the seven reproductions from the proposal and record the result.
