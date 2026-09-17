## Context

The UniProt retriever emits the same empty-string representation for every unavailable field on an unresolved identifier and for a genuinely absent field on a resolved UniProt entry. `AnnotationTransformer` currently converts `xref_pdb` using only that field, so both cases become `False`. The transformed annotation dictionary already includes `uniprot_kb_id`, which is populated for resolved entries and empty for unresolved or deleted entries.

## Goals / Non-Goals

**Goals:**

- Preserve the three evidence states for PDB availability: present, confirmed absent, and unavailable.
- Prevent previously persisted bad PDB values from bypassing the corrected semantics.
- Keep canonical signal-peptide booleans stable across mixed cache/refetch runs.
- Keep the existing annotation schema and frontend missing-value contract.
- Cover the distinction with the smallest focused regression test.

**Non-Goals:**

- Change UniProt accession recognition or inactive-entry resolution.
- Refactor the annotation model or unrelated boolean-like annotations.
- Change the bundle wire format or frontend rendering.

## Decisions

### Use the resolved UniProt identifier as transformation context

The PDB transformation will consider both `xref_pdb` and the sibling `uniprot_kb_id` field. An empty `uniprot_kb_id` means the UniProt-derived assertion is unavailable and therefore preserves an empty `xref_pdb`; a populated identifier allows the existing true/false conversion.

This keeps provenance at the point where both fields are already available. The alternative of omitting `xref_pdb` from unresolved retriever records would make annotation dictionaries non-uniform and would still leave cached or partially populated records ambiguous. Introducing a new provenance field would be broader than this issue because `uniprot_kb_id` already provides the necessary signal.

### Preserve the existing empty-string missing representation

The producer will emit `""` rather than a new sentinel such as `None` or `N/A`. Existing bundle creation normalizes missing cells to empty strings, and the TypeScript ingestion boundary already converts empty strings to its canonical N/A category. This avoids a wire-format or frontend change.

### Make PDB canonicalization idempotent across cache reads

Persisted annotations already contain the canonical strings `""`, `"False"`, and `"True"`, but cached and freshly retrieved sources share the same merge-and-transform pipeline. The PDB transformation will therefore preserve canonical boolean strings before applying raw PDB-ID truthiness conversion. This keeps mixed cache/fetch runs on one transformation path without allowing a cached `"False"` string to become `"True"`.

Skipping transformations for all cached UniProt data was rejected because the manager can merge cached annotations with newly fetched sources in the same run, and bypassing the shared transformation stage would require broader provenance tracking.

### Version transformed annotation-cache semantics in Parquet metadata

`all_annotations.parquet` will carry a `protspace_annotation_cache_version`
DataFrame attribute in its Parquet metadata after the shared transformer has produced
the cached values. An unversioned cache containing `xref_pdb` predates the three-state
contract and cannot be repaired locally: a mapped canonical `"True"` may be a genuine
PDB hit or a legacy empty value that was transformed twice. The pipeline will therefore
drop and refetch the cached UniProt columns once, preserve other source columns, and
write the current marker with the corrected result.

The version number will drive that decision rather than merely record it. A single
table maps each version to the columns whose stored meaning changed at that version,
and the cache version is derived from the table's highest key so the two cannot drift
apart. The pipeline reads nothing else: it intersects the table's entries newer than a
cache's stamp with that cache's columns to get the stale set, and derives the sources to
refresh from those columns. Hardcoding the affected column in the pipeline was rejected
because it decouples the marker from its meaning — a later version bump would silently
re-run the PDB refresh for caches already stamped for it, and stamp caches that were
never migrated for the new change.

Cached taxonomy is source-owned independently, but its cache representation is keyed by
the UniProt-owned `organism_id`. When taxonomy is reused during a UniProt refresh, the
pipeline will retain that one dependency until the manager has rehydrated the cached
taxonomy dictionary. Cached UniProt records are still excluded from the merge, and the
freshly fetched `organism_id` selects the rehydrated taxonomy record, so stale UniProt
outputs cannot survive the migration.

The migration adds its required UniProt refresh to the source plan derived from missing
annotations. Only an explicit `--refetch` request replaces that derived plan. This keeps
newly requested taxonomy, InterPro, TED, and Biocentral annotations fetchable during the
same run that upgrades a legacy PDB cache.

The migration runs only for stale columns the current run actually surfaces: an explicit
annotation selection that omits one, or a run whose output is restricted away from it,
must not pay a source refetch for a column nobody reads. `xref_pdb` is absent from the
default annotation group, so this is the common case rather than the exception. When a
stale column is unused, the pipeline drops it from the cached frame instead of refreshing
it, so it cannot ride along into a cache that this run stamps as current. A later run that
does request it then sees it as missing and fetches it through the ordinary path.

The retriever exposes UniProt batch-failure state to the manager. A migration-triggered
write is suppressed when any UniProt batch fails, leaving the unversioned cache in place
so the next run retries instead of certifying partial empty results as current. The
current run additionally falls back to the preserved cached UniProt values rather than
emitting the empty annotations a failed fetch produces, so a transient outage cannot make
a migration run's output worse than the cache it declined to overwrite. `xref_pdb` is
excluded from that fallback because repairing its ambiguity is the point of the
migration, so it stays missing until a refresh succeeds. Explicit refetches keep their
existing behavior: a user who asked for fresh UniProt data is not silently served cached
values.

Using the existing Parquet metadata channel avoids a sidecar file and does not expose
an internal version column to bundle consumers. Invalidating every annotation cache was
rejected because caches without `xref_pdb` cannot contain the affected value. Inferring
correctness from row values was rejected because the ambiguous mapped `"True"` state has
no reliable local discriminator.

### Preserve cached signal-peptide booleans

InterPro signal-peptide values share the merge-and-transform path used by freshly
retrieved annotations. The transformer will preserve exact canonical `"True"` and
`"False"` values before checking a raw InterPro value for `SIGNAL_PEPTIDE`. This keeps
cached InterPro positives stable when a separate source such as UniProt is refetched,
without changing raw InterPro interpretation.

### Derive the annotation schema from every record, on every output path

Merged annotation records can have non-uniform keys: for example, an unresolved first
protein has no taxonomy fields while a later resolved protein can carry cached `genus`.
Schema derivation will therefore collect annotation keys across all records before
building rows, preserving their first-seen order and filling absent values with the
existing empty-string representation. This keeps schema membership independent of row
order without introducing source ownership knowledge into the generic writer.

`DataFormatter` owns that derivation and `AnnotationWriter` calls it, so the file
writers and the in-memory DataFrame path cannot disagree about which columns exist.
Both paths are reachable for the same data: `protspace annotate`, a `prepare` run
without `--keep-tmp`, and the suppressed-write migration-failure branch all return the
in-memory frame rather than reading back a written Parquet file.

## Risks / Trade-offs

- **[Risk] A transformed record could omit `uniprot_kb_id`.** → Absence means the caller did not supply mapping context (for example, a partial-header writer call), so preserve the established value-only PDB conversion. An explicitly blank identifier remains the unresolved-entry signal.
- **[Risk] A cell read back through pandas is `NaN`, not `""`.** → `NaN` is truthy and stringifies to `"nan"`, so a plain truthiness test would read a missing cell as a PDB hit. Blankness is therefore tested explicitly for both the value and the mapping context, while `None` continues to mean "no context supplied".
- **[Risk] Existing consumers may have counted unmapped values as `False`.** → The change intentionally corrects that semantic category while leaving mapped entries unchanged.
- **[Risk] A raw retriever value could resemble a canonical boolean string.** → UniProt PDB cross-references use PDB identifiers, so exact `"True"` and `"False"` values are reserved for ProtSpace's persisted representation.
- **[Risk] A legacy cache is reused while offline.** → The affected UniProt values are
  epistemically ambiguous, so the pipeline attempts the same source fetch used by an
  explicit UniProt refresh rather than certifying guessed values as current.
- **[Risk] Cache metadata is absent after external rewriting.** → Treat the cache as
  legacy and perform the safe one-time refresh again.

## Migration Plan

Existing bundles remain readable and are not rewritten. On the next prepare run, an
unversioned `all_annotations.parquet` containing `xref_pdb` automatically refetches its
UniProt columns, retains cached columns from other sources and the temporary taxonomy
lookup dependency, and includes every annotation key observed across all rows in the
replacement cache before stamping `protspace_annotation_cache_version = 1`. Newly
generated caches carry that marker from their first write. Rollback can ignore the
marker because it lives in Parquet metadata; no schema, bundle format, or dependency
migration is required.

## Open Questions

None.
