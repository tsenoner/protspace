## Context

`ProtSpace_Preparation.ipynb` keeps `output/tmp` so expensive FASTA downloads, embeddings, and annotations can survive repeated Generate actions. `ReductionPipeline` also stores projections there. Projection keys already include the logical embedding name, method, dimensions, and every reducer parameter, so the slider-only symptom in issue #338 is not reproduced by the current implementation. The reproducible collision is broader: the notebook originally shared every query FASTA, model H5, annotation set, and projection directory. Input-content partitioning separates datasets, but an H5 still needs producer ownership because Local and Biocentral both resume by identifier, and a query FASTA must not appear at its final cache path until extraction completes.

## Goals / Non-Goals

**Goals:**

- Guarantee that every Preparation-notebook Generate action reduces the current embedding data.
- Preserve caching for compatible query, embedding, and annotation inputs.
- Prevent query, embedding, and annotation cache reuse across incompatible inputs.
- Prevent embedding reuse across producing backends while preserving reuse within one backend and model.
- Make a query FASTA visible as a cache hit only after complete, validated extraction.
- Cover changed queries, disjoint inputs, same-ID sequence changes, annotation identifiers, and projection refresh with focused regressions.

**Non-Goals:**

- Redesign projection cache identity for CLI users.
- Disable every notebook cache or redesign backend resume semantics.
- Change reducer parameters, projection naming, bundle layout, or output paths.

## Decisions

### Request the existing projections refetch stage from the notebook

The notebook will construct `PipelineConfig` with `refetch_stages=frozenset({"projections"})`. `ReductionPipeline._load_cached_projection` already treats that stage as an instruction to bypass cached coordinates, while the other retained intermediates remain available.

This uses the pipeline's public configuration contract and keeps cache lifecycle in one place.

Reducer-parameter changes already select a distinct projection cache key. Explicit projection refresh remains a notebook-level correctness guarantee and also protects same-name inputs whose matrices differ.

**Alternative: delete `proj_*.npz` files before each run.** Rejected because it duplicates cache naming/lifecycle knowledge in the notebook and introduces an unnecessary destructive filesystem operation.

**Alternative: hash all embedding bytes and headers in the core projection key.** Rejected because it broadens CLI cache semantics and adds hashing cost to all callers. The notebook explicitly wants fresh projections on Generate, so selecting the existing refetch stage is clearer and narrower.

### Partition retained notebook caches by their owning input

UniProt query FASTA paths are derived from a short SHA-256 digest of the exact query text. Once an input file is available, the notebook derives its intermediate directory from a streaming SHA-256 digest of that file's bytes. Query and uploaded FASTA inputs therefore place embedding, annotation, and projection intermediates under a content-owned directory; H5 inputs use the same rule directly.

This keeps byte-identical inputs reusable while separating changed queries, disjoint FASTA files, and same-identifier sequences whose residues changed. The helper functions live beside the existing pipeline cache logic, and the notebook supplies the resulting directory through the existing `PipelineConfig.intermediate_dir` contract.

**Alternative: teach each embedding backend to reconcile per-sequence hashes inside H5.** Rejected because both backends already implement resumable H5 writes and changing that format would broaden this notebook-scoped fix.

### Include the embedding producer in H5 ownership

Within an input-content directory, the notebook names each embedding H5 with the resolved backend and selected model. The input digest still owns the sequences, the model name still owns the requested representation, and the backend namespace prevents Local-produced identifiers from satisfying Biocentral's resume check or vice versa. Repeating the same input, backend, and model selects the same H5 and preserves the intended resume behavior.

The notebook constructs fixed default backend configurations. Their batch sizes affect scheduling rather than vector identity, so no additional configuration hash is introduced.

**Alternative: store and validate producer metadata inside every H5.** Rejected because producer-specific paths close the notebook collision without changing the shared H5 format or backend APIs.

### Publish query FASTA caches atomically

`query_uniprot` streams a downloaded gzip into a temporary sibling of the requested cache file, so a truncated or corrupt download raises during extraction, and reads the identifiers from that staged FASTA. Only after extraction completes does it replace the final path atomically. The download is decompressed once and never held in memory whole; a second parse of the same bytes to cross-check identifiers could not disagree, so none is made. A `finally` cleanup removes the compressed download and any incomplete staged output, so interruption cannot leave a nonempty final-path artifact for the next Generate action to accept.

Before publication, the staged file receives the permissions that a normal new file would receive under the process umask. Atomic replacement therefore does not make the retained FASTA less accessible than the direct-write behavior it replaces.

**Alternative: persist a separate completion marker.** Rejected because same-directory atomic replacement makes final-path existence the completion signal without a two-file consistency problem.

### Validate annotation identifiers before reuse

`ReductionPipeline._fetch_annotations` verifies that the cached identifiers cover every requested identifier before considering cached columns. Missing requested identifiers rebuild the annotation cache for the current headers instead of passing incompatible rows into the bundle merge. That rebuild does not protect the rejected cache's columns: otherwise one source failing during it would keep the other input's file and discard every source that did complete. A cached superset remains reusable because the pipeline's later identifier merge drops rows outside the current input; this preserves the existing subset-run behavior and leaves a larger cache untouched whenever it is reused without a fetch.

### Exercise actual cache behavior in the regression

The projection regression uses a normally constructed `ReductionPipeline` and substitutes only the reducer call. It runs two same-name embedding sets with different data through the notebook's configured projection refresh, then asserts the reducer sees both inputs and the second result reflects the second input. Additional focused tests assert cache paths differ for query changes, disjoint FASTA inputs, and same-ID changed sequences, and that annotation identifiers are validated before reuse.

The notebook artifact will also be validated as a parseable notebook with parseable code cells, following existing notebook verification practice.

## Risks / Trade-offs

- **Projection reruns take longer even when nothing changed.** → This is the explicit notebook correctness contract; expensive embedding and annotation intermediates remain cached.
- **Hashing an input file adds one sequential read per Generate action.** → Example and uploaded inputs are already read for processing, and the bounded cost avoids far more expensive incompatible embedding reuse.
- **Any FASTA content change selects a new embedding cache and re-embeds the complete file.** → This deliberately gives same-identifier sequence changes correct ownership without redesigning the shared H5 format around per-sequence hashes; incremental per-sequence invalidation remains outside this notebook-scoped change.
- **Backend-qualified H5 names leave prior unqualified files unused.** → They remain recoverable but are intentionally ignored because their producer cannot be proven.
- **An interruption can leave the previous complete query FASTA in place.** → Atomic replacement preserves that known-complete artifact; incomplete staged output is removed and never published.
- **Old shared cache files remain under `output/tmp`.** → New input-owned paths ignore them; no destructive migration is required.
- **The regression could test pipeline behavior without proving notebook wiring.** → Verification will additionally inspect the executed notebook configuration path and validate all notebook code cells.
- **A future pipeline refetch API rename could break the notebook.** → The focused pipeline regression and notebook configuration verification make that failure visible.

## Migration Plan

No data migration is required. Existing shared FASTA, annotation, and projection files plus backend-unqualified embedding H5 files may remain in `output/tmp`; the notebook uses query-, input-, and producer-owned paths and stops reading entries whose ownership cannot be proven. Rollback restores the shared cache paths and removes the explicit projection refresh.

## Open Questions

None.
