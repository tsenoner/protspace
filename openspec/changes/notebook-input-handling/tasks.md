## 1. Failing tests first

- [ ] 1.1 `tests/test_notebooks.py`: run cells 1-2 with real ipywidgets and a mocked `google.colab`; loading an attribute-less `*_esm2_650m.h5` and clicking Generate writes a bundle labelled `ESM2-650M`
- [ ] 1.2 Generate on an empty selected tab refuses and does not process the example; building the panel performs no network I/O
- [ ] 1.3 The CSV upload helper reads both the ipywidgets 7 and 8 `FileUpload` value shapes
- [ ] 1.4 The Embeddings notebook writes `model_name` (structural check)

## 2. Preparation notebook

- [ ] 2.1 Upload cell above the panel, guarded by a checkbox, filling the matching path field
- [ ] 2.2 HDF5 and FASTA tabs: path field, Load button, states; embedder dropdown with Auto-detect on the H5 tab
- [ ] 2.3 Per-tab inputs; Generate uses the selected tab, refuses an empty one, echoes the input
- [ ] 2.4 Example fetched in Generate with a timeout; Generate disabled while running; observers captured; protspace logging routed to the output
- [ ] 2.5 Metric selector; `min_dist` 0.1; CSV-only preset; version-agnostic CSV `FileUpload`
- [ ] 2.6 Cell 1 guard catches any exception with the upgrade hint
- [ ] 2.7 "Going further" CLI example and the H5 error text

## 3. Embeddings notebook

- [ ] 3.1 Write `model_name` on the produced HDF5

## 4. Docs

- [ ] 4.1 `docs/guide/data-preparation.md`: four-tab panel, upload routes and size caveat, Run all, 2-D only, MDS CLI-only, taxonomy tip removed, naming no longer needed
- [ ] 4.2 `apps/protspace/CLAUDE.md`: `test_notebooks.py` row

## 5. Verify

- [ ] 5.1 `uv run pytest tests/test_notebooks.py` with the locked ipywidgets 8 and with `--with ipywidgets==7.7.1`
- [ ] 5.2 Full `apps/protspace` suite, ruff, `pnpm precommit`, `pnpm format:check`
- [ ] 5.3 `openspec validate notebook-input-handling --strict`
