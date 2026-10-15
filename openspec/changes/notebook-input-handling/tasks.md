## 1. Failing tests first

- [x] 1.1 `tests/test_notebooks.py`: run cells 1-3 (install, upload, panel) with real ipywidgets and a mocked `google.colab`; loading an attribute-less `*_esm2_650m.h5` and clicking Generate writes a bundle labelled `ESM2-650M`
- [x] 1.2 Generate on an empty selected tab refuses and does not process the example; building the panel performs no network I/O
- [x] 1.3 The CSV upload helper reads both the ipywidgets 7 and 8 `FileUpload` value shapes
- [x] 1.4 The Embeddings notebook writes `model_name` (structural check)
- [x] 1.5 Review: re-uploading a same-named file loads the new one; the H5 tab shows no `:<model>` CLI syntax; Auto-detect without the resolver names files as the resolver does; Generate is disabled during a run; CSV only without a CSV is refused; a gzipped CSV is read; a failed example fetch is reported and re-enables Generate; a cosine UMAP records `metric: cosine`

## 2. Preparation notebook

- [x] 2.1 Upload cell above the panel, guarded by a checkbox, filling the matching path field
- [x] 2.2 HDF5 and FASTA tabs: path field, Load button, states; embedder dropdown with Auto-detect on the H5 tab
- [x] 2.3 Per-tab inputs; Generate uses the selected tab, refuses an empty one, echoes the input
- [x] 2.4 Example fetched in Generate with a timeout; Generate disabled while running; observers captured; protspace logging routed to the output
- [x] 2.5 Metric selector; `min_dist` 0.1; CSV-only preset; version-agnostic CSV `FileUpload`
- [x] 2.6 Cell 1 guard catches any exception with the upgrade hint
- [x] 2.7 "Going further" CLI example and the H5 error text
- [x] 2.8 Review: upload into a fresh folder per run; Auto-detect silences the resolver's CLI hint and its fallback applies the file-name rule; the custom CSV is gunzipped like H5 and FASTA

## 3. Embeddings notebook

- [x] 3.1 Write `model_name` on the produced HDF5

## 4. Docs

- [x] 4.1 `docs/guide/data-preparation.md`: four-tab panel, upload routes and size caveat, Run all, 2-D only, MDS CLI-only, taxonomy tip removed, naming no longer needed
- [x] 4.2 `apps/protspace/CLAUDE.md`: `test_notebooks.py` row

## 5. Verify

- [x] 5.1 `uv run pytest tests/test_notebooks.py` with the locked ipywidgets 8 and with `--with ipywidgets==7.7.1`
- [x] 5.2 Full `apps/protspace` suite, ruff, `pnpm precommit`, `pnpm format:check`
- [x] 5.3 `openspec validate notebook-input-handling --strict`
