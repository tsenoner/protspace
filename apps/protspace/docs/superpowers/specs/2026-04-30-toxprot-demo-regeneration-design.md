# Toxprot demo bundle regeneration — design

**Date:** 2026-04-30
**Status:** Design approved, ready for plan

## Goal

Recreate the demo `.parquetbundle` shipped at
`protspace_web/app/public/data.parquetbundle`, using the toxprot UniProt
query, but with two new behaviours:

1. **Strip signal peptides** from sequences before embedding (so the
   pLM sees the mature, secreted protein — not the export tag).
2. **Add ESMC-300m** alongside the existing ProtT5 embedding, giving four
   projections (PCA_2 + UMAP_2 per embedder).

The dataset uses raw `length` (the frontend now does its own binning;
the legacy `length_quantile` annotation is gone). Existing styling for
`pfam`, `ec`, `superfamily`, `protein_families`, `cath` is preserved
byte-for-byte from the old bundle.

## Source query

```
(taxonomy_id:33208) AND (cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND (reviewed:true)
```

(Metazoa × venom-tissue OR secreted-from-venom-gland × Swiss-Prot.)

## Architecture

A single standalone Python script — no library or CLI changes.

- **Path:** `scripts/generate_toxprot_demo.py`
- **Output:** `data/toxins/data.parquetbundle`
- **Cache:** `data/toxins/tmp/` (FASTA, TSV, mature-lengths map, embeddings, annotations)

The script does only the toxprot-specific work — fetch sequences + SP
positions from UniProt, strip SPs, write a mature FASTA. Everything
else (embedding, DR, annotations, bundling) is delegated to
`protspace prepare` via `subprocess`, mirroring the pattern used by
`scripts/generate_examples/generate.py`. Settings and the `length`
column are patched in a single post-process step.

### Pre-run cleanup (one-time)

The current `data/toxins/` contains legacy artifacts (`toxins.h5`,
`toxins.json`, `toxins.parquetbundle`, a `protspace/` subdir). Before
the first run we wipe the directory manually:

```bash
rm -rf data/toxins/
```

Future re-runs leave the dir intact and rely on the `tmp/` cache for
idempotency.

## Components

### 1. `fetch_toxprot_tsv(query, out_path) -> Path`

Streams a TSV from UniProt:

```
GET https://rest.uniprot.org/uniprotkb/stream
    ?query=<query>&format=tsv&fields=accession,sequence,ft_signal&compressed=true
```

One request, gzip on the wire, decompressed and written to
`data/toxins/tmp/toxprot.tsv`. Cache hit (file exists, non-empty)
returns the path without re-fetching.

### 2. `parse_signal_peptides(tsv_path) -> dict[str, int]`

Returns `{accession: sp_end_position}` for entries with a confidently
bounded signal peptide. UniProt's `ft_signal` is a free-text field;
typical values look like `SIGNAL 1..23; /evidence="..."`. We extract
the end position with a regex matching `SIGNAL\s+\d+\.\.(\d+)`.

Skipped (treated as no SP, full sequence kept):

- Empty `ft_signal`.
- Bounds containing `?`, `<`, `>` (uncertain bounds).
- Multiple SP features on a single entry (rare; safer to keep full).

Logs a single summary line:
`N proteins, M with confirmed SP, K skipped (uncertain bounds)`.

### 3. `write_mature_fasta(tsv_path, sp_map, fasta_out) -> dict[str, int]`

Iterates the TSV, writes a FASTA where SP-bearing sequences are
cleaved (`seq[sp_end:]`), others are full-length. Header format:
`>{accession}` so the existing `parse_identifier` in
`data/loaders/h5.py` matches without colon parsing.

Returns `{accession: mature_length}` for the post-process step. Also
writes the dict to `data/toxins/tmp/mature_lengths.json` for cache hits
on re-runs.

### 4. `postprocess_bundle(bundle_path, mature_lengths, source_settings_bundle)`

Single function combining the length override and the settings copy:

1. `read_bundle(bundle_path)` → 3 part-bytes + (probably absent) settings.
2. Decode each part to a `pyarrow.Table`.
3. On the annotations table, build a new `length` column by mapping
   `protein_id → mature_lengths[id]` (fallback: keep canonical
   length if missing — defensive, but shouldn't happen).
4. `read_bundle(source_settings_bundle)` → grab settings dict.
5. `write_bundle([annotations, projections_metadata, projections_data],
   bundle_path, settings=settings_dict)`.

Re-uses the existing helpers in `protspace/data/io/bundle.py`.

## Data flow

```
UniProt query (TSV: accession,sequence,ft_signal)
  ↓ fetch_toxprot_tsv
data/toxins/tmp/toxprot.tsv
  ↓ parse_signal_peptides
{accession: sp_end} for confidently-bounded SPs
  ↓ write_mature_fasta
data/toxins/tmp/toxprot_mature.fasta + {accession: mature_length}
  ↓ subprocess: protspace prepare -i toxprot_mature.fasta
  │     -e prot_t5,esmc_300m
  │     -m "umap2:n_neighbors=50;min_dist=0.5,pca2"
  │     -a default,interpro,taxonomy --random-state 42 -o data/toxins/ -v
data/toxins/data.parquetbundle  (4 projections, no settings, canonical length)
  ↓ postprocess_bundle (length override + settings patch)
data/toxins/data.parquetbundle  (4 projections, mature length, full styling)
  ↓ user copies →
protspace_web/app/public/data.parquetbundle
```

The `protspace prepare` cache (`data/toxins/tmp/`) ensures re-runs skip
already-done embeddings and annotation fetches.

## Configuration choices

| Choice | Value | Rationale |
|---|---|---|
| Embedders | `prot_t5`, `esmc_300m` | ESMC-300m is permissively licensed (Cambrian Open). 600m is non-commercial — avoid for a public demo. |
| DR methods | `pca2`, `umap2` | Match old bundle. |
| UMAP params | `n_neighbors=50, min_dist=0.5, random_state=42` | Match old bundle exactly. |
| PCA params | sklearn defaults | Match old bundle (`svd_solver=arpack` is auto-picked). |
| Annotations | `default,interpro,taxonomy` | Matches the old bundle's column set: `ec`, `keyword`, `length`, `protein_families`, `reviewed` (default) + `cath`, `pfam`, `superfamily` (interpro) + `phylum`, `class`, `order`, `family`, `genus`, `species` (taxonomy). The frontend bins `length` itself; `length_quantile` is no longer emitted. |
| `length` column | mature length (post-cleavage) | Per user requirement. |
| Settings | byte-for-byte from old web bundle | Stale-but-harmless: any styled categories absent in new data simply don't color anything. Re-style later via `protspace style` if needed. |

## SP-stripping edge cases

| Case | Behaviour |
|---|---|
| No SP annotated | Keep full sequence. Most non-secreted toxins fall here. |
| Confident SP (`SIGNAL 1..23`) | Cleave at end position; embed mature peptide. |
| Mature peptide very short (< 20 aa) | Embed anyway. pLMs handle short sequences; no minimum. |
| Uncertain bounds (`?`, `<`, `>`) | Treat as no SP; keep full sequence. Curators couldn't confirm — safer default. |

## Error handling

Boundary checks only — no retries, no fallback paths.

| Failure | Handling |
|---|---|
| UniProt stream HTTP error | `requests.raise_for_status()` propagates with URL + status |
| Empty TSV (zero hits) | `SystemExit("No proteins returned for query")` |
| TSV missing required columns | `SystemExit("Unexpected TSV schema: <cols>")` |
| `protspace prepare` non-zero exit | `subprocess.run(..., check=True)` raises; propagate |
| Source settings bundle missing | `SystemExit("Source settings bundle not found: <path>")` |
| Bundle missing after prepare | `SystemExit("prepare did not produce <path>")` |

## Testing

`tests/test_toxprot_demo.py` — three unit tests, no live API calls.

1. **`test_parse_signal_peptides_handles_uncertain_bounds`**
   Synthetic TSV with clean SP, `?..30`, `<1..25`, `>20..30`, no-SP.
   Assert only the clean SP appears in the returned map.

2. **`test_write_mature_fasta_strips_correctly`**
   Synthetic TSV + SP map → FASTA on disk.
   Assert SP-bearing records trimmed at the right index, non-SP records
   kept whole, and the returned `{accession: mature_length}` dict
   matches.

3. **`test_postprocess_bundle_replaces_length_and_settings`**
   Build a small synthetic bundle via `write_bundle`, run
   `postprocess_bundle`, assert `length` column reflects the
   mature-lengths dict and settings round-trip via JSON.

The full pipeline (live UniProt + Biocentral) is verified by running
the script once against the real query.

## CLI

```bash
uv run python scripts/generate_toxprot_demo.py \
    [--output data/toxins/] \
    [--source-settings ../protspace_web/app/public/data.parquetbundle]
```

Both flags have sensible defaults pointing to the in-repo paths above.

## Out of scope

- Promoting SP-stripping to a `protspace prepare --strip-signal-peptide`
  flag. (Consider later if other datasets need it.)
- Re-styling settings against the new top-N categories.
- Auto-copying to `protspace_web/app/public/`. User does this manually.
- Re-running the existing `protspace style` command on the new bundle.
- Updating `scripts/generate_examples/datasets.toml` (toxprot has
  bespoke SP-stripping; doesn't fit the simple TOML shape).

## Files touched

| Path | Change |
|---|---|
| `scripts/generate_toxprot_demo.py` | new file |
| `tests/test_toxprot_demo.py` | new file |
| `data/toxins/` | wiped + repopulated |
| `docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md` | this document |
