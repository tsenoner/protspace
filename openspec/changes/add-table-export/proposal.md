## Why

Everything ProtSpace computes per protein ends up in the bundle: annotations, the `cluster_*`
memberships `stats` writes, the EAT `__pred_*` columns `transfer` writes, the coordinates. None
of it can be taken out as a table. The web app exports images, a protein-ID list or another
bundle; the CLI has no export at all. A user who wanted "the proteins in cluster 3 with their
families" had to export IDs one cluster at a time and join them back by hand, or write pandas
against `read_tables` and decode the cells themselves.

## What Changes

- **`protspace export BUNDLE OUTPUT.tsv`**: writes the bundle as one tab-separated table, one row
  per protein: `protein_id`, then `<projection>_x` / `_y` for each projection named with
  `-p/--projection` (none by default), then every annotation column in bundle order, including
  `cluster_*` and the EAT `__pred_*` columns. Cells are written as the app displays them: score
  and evidence suffixes dropped, percent-encoding decoded, hits of a multi-valued cell joined
  with `;`, missing values empty.
- **`read_bundle_table(path, projections=())`** in `protspace.data.io.bundle`: the same table as a
  pandas DataFrame, for scripts and notebooks.
- **Web Quick Export "Table (TSV)"**: a fourth data format beside IDs and Parquet. It writes the
  proteins currently visible, the same set the Protein IDs export writes (filters, the EAT
  reliability filter, isolation and hidden legend categories all apply), with `protein_id`, the
  current projection's coordinates and every annotation, the EAT companions included.
- The docs say what the existing ID export honours (the page says only "isolated or all").

### Non-goals

- CSV or Excel output. TSV opens in every spreadsheet and needs no quoting for the protein names
  and labels ProtSpace stores; a field that does hold a tab, newline or quote is quoted.
- Filters in the CLI export. `pandas` on the TSV, or the web export, covers subsets.
- Scores and evidence codes as their own columns.

## Capabilities

### New Capabilities

- `table-export`: the tabular export of a bundle, from the CLI and from the web app, and which
  proteins and columns it holds.

### Modified Capabilities

None.

## Impact

- Python: new `apps/protspace/src/protspace/cli/export.py`, registered in `cli/app.py` under
  the Refine panel; `read_bundle_table` in `data/io/bundle.py`. `feat:` on `apps/protspace/`.
- Web: `packages/utils/src/visualization/export-utils.ts` (`exportTable`, visible-protein set
  shared with `exportProteinIds`), `packages/core/src/components/control-bar/control-bar.ts`
  (format button), `apps/web/src/explore/export-handler.ts` (dispatch).
- Docs: `docs/explore/exporting.md`, `docs/guide/python-cli.md` (command table and section),
  `docs/guide/data-format.md` (Read a bundle in Python); `apps/protspace/CLAUDE.md`.
- Tests: `tests/test_export_cli.py` (new), `export-utils.test.ts`, control-bar test, and an e2e
  spec for the Quick Export path.
