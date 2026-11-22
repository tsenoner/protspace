## Context

The `examples` release pairs each example's `<name>_prot_t5.h5` with `<name>.parquetbundle`, both
mirrored from the pre-monorepo release (legacy v1 bundles, protein sets equal to the `.h5` keys).
The Preparation panel's Example tab fetches every annotation for the `.h5`'s proteins on each
Generate; the Transfer notebook runs EAT on `snake_toxin.parquetbundle`.

## Goals / Non-Goals

**Goals:**

- v3 bundles whose annotations equal what the panel's own fetch returns today, so reusing them
  changes no value.
- No annotation fetch for an Example-tab run whose request the bundle covers.

**Non-Goals:**

- Recomputing projections. The embeddings have not changed, and beta-lactamase's ESM2 and globin's
  MMseqs2 projections have no published input to recompute them from.
- Replacing the v1 files: they keep their name and bytes, so no link to them changes meaning.

## Decisions

- **New names, `<name>_v3.parquetbundle`.** A published name never gets new bytes, as for the
  showcase release.
- **Annotations through `protspace annotate` on the `.h5`**, the same manager and cache rules as
  the panel's `pipeline._fetch_annotations`, with the dataset's set from `datasets.toml`.
- **Reuse per column.** The panel expands the request with `AnnotationConfiguration` (as the
  annotation cache does), takes the columns the bundle holds, and fetches only the others plus a
  custom CSV; the fetched frame's columns that the bundle also holds are dropped before the merge,
  so the bundle's values win for the always-included columns.
- **Read with `read_tables`**, the public reader that hands back the v2-shaped table the fetch
  returns, so the merged frame needs no conversion.

## Risks / Trade-offs

- [Bundle values age as UniProt moves on] → The note says the columns came from the bundle and
  names "Fetch annotations again", which fetches current values.
- [Snake Toxin's deleted entries lose their annotations] → They are blank in a fresh fetch too; the
  Transfer notebook's counts are updated to the new bundle.
