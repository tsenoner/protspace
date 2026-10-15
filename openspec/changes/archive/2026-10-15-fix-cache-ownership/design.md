## Context

`{output}/tmp` is shared by every run that writes to the same `-o`, and the notebook's `output/tmp` is shared by every Generate action. Cache entries in it are addressed by _names_ — the embedding name for a projection, the model name for an HDF5, `sequences.fasta` for a query — while what makes an entry reusable is the _data_ behind that name. Every defect in the proposal is that gap, and each was reproduced against the CLI layout, not only the notebook.

The first iteration closed the gap for the notebook by addressing directories with a digest of the input file. That is the same idea applied one layer too high: it re-reads multi-gigabyte inputs on every Generate action, forfeits per-protein embedding resume on any byte change, and leaves `protspace prepare` broken.

## Goals / Non-Goals

**Goals:**

- Make each retained artifact's identity include what it was computed from, in the shared layer, so the CLI, the notebook, and the hosted prep service all get it.
- Keep resumability: per protein for embeddings, per identifier and column for annotations, per parameter set for projections.
- Keep retained caches from earlier versions usable without a forced recompute.
- Let the notebook shrink back to configuration plus display.

**Non-Goals:**

- Redesigning the bundle format, projection naming, or output paths.
- Making the notebook call `ReductionPipeline.run()` (it needs per-stage progress; tracked separately).
- Garbage-collecting cache entries that ownership makes unreachable.

## Decisions

### Projection identity includes the matrix and the identifier order

`_projection_cache_path` adds a fingerprint to its key: a SHA-256 over the identifier list, the dtype, the shape, and the matrix bytes, computed once per embedding set per run and reused across that set's methods.

Measured at 2.7 GB/s, so ~0.9 s for a 573K × 1024 float32 matrix (a few seconds on a Colab CPU), against reducer runtimes of minutes at that size. Including the identifiers is what makes a reordered or grown input miss: coordinates are stored as bare rows and paired positionally with the current identifiers on load, so an order change silently relabels every point.

The notebook then drops `refetch_stages={"projections"}`: with data identity in the key, returning to an earlier slider value is a correct cache hit rather than a stale one.

**Alternative: keep the notebook's blanket refetch.** Rejected: it fixes one caller, leaves `prepare -o` stale, and makes the notebook write `proj_*.npz` files nothing ever reads.

**Alternative: hash a sample of the matrix.** Rejected: a cheap fingerprint that can collide re-introduces exactly the silent staleness being removed, and the full hash is already negligible next to the reducers.

### Embedding identity is stamped in the HDF5, not in the file name

The shared store writes two root attributes (`protspace_backend`, `protspace_model`) and one per-protein attribute (`protspace_sequence_sha256`, the first 16 hex characters of the residue digest). Resume rejects a file stamped by another producer with a `ValueError` naming the remedies, and treats a protein whose digest differs from its current residues as outstanding, replacing that dataset.

Attributes rather than file names because the file name is a caller's choice and the contract belongs to the file: `protspace embed -o mine.h5` gets the same protection as a managed cache. Cost measured at 50K proteins: writing +0.6 s (against hours of embedding), reading digests on resume +1.6 s per 50K (~19 s for Swiss-Prot, against a full `load_h5` of the same file).

Legacy files carry neither attribute. A file with no producer is adopted and stamped, with a log line; a protein with no digest is trusted. Refusing them instead would force a full re-embed of every existing cache on upgrade, which for a Biocentral-sized run costs hours to protect against a mix that ownership now prevents going forward.

The CLI keeps its `tmp/{model}.h5` naming, so existing caches stay valid and a backend switch is an explicit error. The notebook prefixes the backend into the name, because switching backends there is a toggle in the panel rather than a new command, and both files are worth keeping.

**Alternative: per-sequence hashes in a side file.** Rejected: two files that can disagree, where the attribute cannot.

### An embedding load returns the requested proteins

`embed_fasta` restricts the returned set to the FASTA's identifiers. The shared cache legitimately accumulates proteins across inputs — that is what makes resume work — so the loader, not the cache, decides what a run is about.

### Annotation reuse is per identifier as well as per column

The manager already decides per source whether to fetch or to read the cache. That decision becomes per source _and_ per identifier: for a source served from the cache, identifiers the cache does not hold are fetched and merged with the cached rows. Taxonomy is keyed by organism rather than identifier, so it fills in only the organisms its cached lookup lacks.

The cache write keeps rows for identifiers outside the current run when the run's columns are the columns the cache already had, so a subset run no longer shrinks a superset cache. When the columns differ, the existing behaviour stands — the frame for this run is what gets written.

The incomplete-source rules are unchanged and continue to decide what may be written: a source that did not complete for the identifiers being filled in does not reach the cache as empty values.

**Alternative: keep the full rebuild.** Rejected: it is hours of re-fetching for one added protein at Swiss-Prot scale, and it replaces a large cache with the current run's rows.

### One staged-rename helper, respecting the umask

`data/io/atomic.py` provides the write-then-rename helper the bundle writer, the `stats` table rewrites, and the retained query FASTA all use. It creates its temporary file with a normal `open`, so the published file gets the process umask rather than the owner-only mode `mkstemp` gives — which is what a plain write always did, and what the bundle writer has silently not been doing.

### The notebook stops carrying cache logic

With identity in the shared layer, the notebook keeps only what is genuinely a notebook policy: the backend-prefixed HDF5 name and the query-addressed FASTA path, both written inline from `hashlib` and an f-string. No private helper is imported from the package, so the window where the notebook on `main` runs against the previously released package cannot break it.

### Issue #338 is addressed where the reporter sees it

Each Generate action names its bundle `protspace_<timestamp>.parquetbundle` and prints the name, so two downloads are told apart. The parameter section states which methods each control applies to, so a slider that PCA ignores is visibly a slider PCA ignores.

## Risks / Trade-offs

- **A backend switch against an existing cache now fails.** → It silently returned the other backend's vectors before; the message names the three ways forward.
- **Fingerprinting adds one pass over the matrix per run.** → Sub-second at Swiss-Prot scale, against reducers that take minutes.
- **Reading residue digests adds to resume at scale.** → Seconds against an embedding run's hours, and `load_h5` reads the same file anyway.
- **Legacy files are trusted rather than refused.** → Documented, with `--refetch embed` as the remedy; new writes are stamped from now on.
- **A shared annotation cache keeps rows from other inputs.** → Bounded by what the user ran in that output directory, and the pipeline's identifier merge already drops rows outside the current run.
- **Projection and embedding caches recompute once after upgrade.** → Only where their identity was previously unproven.

## Migration Plan

None required. Existing `proj_*.npz` entries miss on their new key and are recomputed once; existing HDF5 files are adopted and stamped on first resume; existing `sequences.fasta` files are ignored in favour of the query-addressed path and can be deleted.

## Open Questions

None.
