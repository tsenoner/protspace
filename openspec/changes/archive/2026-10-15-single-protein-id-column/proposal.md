## Why

The protein ID column of a ProtSpace table is called `protein_id` in some files and `identifier`
in others, for no reason beyond history (#552). Python keys its pipeline, projections, `annotate`
output and `stats` output on `identifier`, and renames it to `protein_id` only when it writes a
bundle's annotations. The web exporter writes `identifier`, and `protein_id` only when an
annotation is itself named `identifier`. So every reader has to accept both names and agree on
which wins when a file holds both, and each new reader is a chance to get it wrong: `transfer`
still refuses such a file (#551).

## What Changes

- Every table ProtSpace writes names its protein ID column `protein_id`: a bundle's part 1 and
  manifest `idColumn` (Python and the web exporter alike), both files of an unbundled directory,
  `annotate` output, the `<stem>.annotations.parquet` `stats -a` writes, and `prepare`'s
  annotation cache. The tables `read_tables` and `read_bundle_contents` hand back are keyed on
  `protein_id` too, projections included.
- A v3 reader takes the ID column from the manifest's `idColumn`, whatever it is called. Python
  hands the decoded table back with that column as `protein_id`.
- A table with no manifest (an unbundled directory, an annotation parquet, a v1/v2 bundle) is
  keyed on `protein_id`, else `identifier`, as today. Beside `protein_id`, `identifier` is an
  annotation. Taking `identifier` as the ID column of a directory or an annotation parquet logs a
  deprecation warning: the name rule ends in 5.0.0 (#544). A v1/v2 bundle already warns for
  itself, and the annotation cache is read without one, since nothing a user wrote is involved.
- `PROTEIN_ID_COLUMN` (`protein_id`) is pinned in `contracts/shared-constants.json`.

## Capabilities

### New Capabilities

- `protein-id-column`: the one name every written table gives its protein ID column, how each
  reader finds it, and the `identifier` name rule kept until 5.0.0.

### Modified Capabilities

- `bundle-format-contract`: the `annotate` stand-in is keyed on `protein_id`, as `annotate` now
  writes, and both writers' manifest `idColumn` is pinned to `PROTEIN_ID_COLUMN`.
- `custom-annotation-files`: `stats -a` writes its table keyed on `protein_id`, and a parquet
  keyed on `identifier` warns.
- `deprecation-policy`: the registry holds the `identifier` name rule.
- `shared-constants`: the shared source holds the protein ID column name.

## Impact

- Python: `data/io/ids.py` (new), `data/io/bundle_v3.py`, `data/io/bundle.py`,
  `data/io/formatters.py`, `data/io/writers.py`, `data/io/predictions.py`,
  `data/annotations/cache.py`, `data/annotations/manager.py`, `data/processors/base_processor.py`,
  `data/processors/pipeline.py`, `data/processors/custom_annotations.py`, `cli/bundle.py`,
  `cli/stats.py`, `cli/transfer.py`, `stats/`, `analysis/classification.py`,
  `utils/arrow_reader.py`, `deprecations.py`.
- Web: `packages/utils/src/parquet/bundle-writer.ts`. The browser's v3 reader already takes
  `idColumn` from the manifest; its v1/v2 reader is left as it is until 5.0.0 removes it.
- Contracts: `contracts/shared-constants.json` and the generated modules; `tests/contract`.
- Docs: `docs/guide/data-format.md`, `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`.
- A script that read `contents.projections["identifier"]` from `read_bundle_contents` reads
  `protein_id` now; the documentation of that table is new in 4.17.0.
