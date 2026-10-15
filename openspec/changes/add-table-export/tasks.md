## 1. Python

- [x] 1.1 `read_bundle_table(path, projections=())` in `data/io/bundle.py`: display-decoded annotations, wide coordinates, `protein_id` first
- [x] 1.2 `cli/export.py`: `protspace export INPUT OUTPUT [-p NAME]...`, registered in `cli/app.py`; unknown projection and unreadable bundle as usage errors
- [x] 1.3 `tests/test_export_cli.py`: decoded cells, multi-hit join, numeric and missing values, coordinates (2D, unplaced protein), unknown projection, EAT and cluster columns, `identifier`-keyed bundle

## 2. Web

- [x] 2.1 `export-utils.ts`: shared visible-protein helper; `exportTable` (columns, quoting, Blob download)
- [x] 2.2 `control-bar.ts`: Table format button; `export-handler.ts`: dispatch `tsv`
- [x] 2.3 Unit tests: `export-utils.test.ts` (rows equal the ID export's, hidden category, numeric, EAT companions, quoting), control-bar format list
- [x] 2.4 e2e: extend the export spec with a Table (TSV) download

## 3. Docs

- [x] 3.1 `docs/explore/exporting.md`: Table format; what both ID and table exports honour
- [x] 3.2 `docs/guide/python-cli.md`: command table row and `protspace export` section
- [x] 3.3 `docs/guide/data-format.md`: Read a bundle in Python (snippet tested)
- [x] 3.4 `apps/protspace/CLAUDE.md`: command row, package structure, test-file row

## 4. Verification

- [x] 4.1 pytest, ruff, `pnpm test`, the export e2e specs, `pnpm precommit`, `pnpm format:check`
- [x] 4.2 `openspec validate add-table-export --strict`
