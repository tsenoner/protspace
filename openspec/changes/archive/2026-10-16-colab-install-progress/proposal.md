## Why

After colab-panel-ux, a fresh Colab runtime still needed a restart on first setup, and users
still could not tell where a run stood:

- Installing protspace upgraded numpy and pandas that Colab had loaded. Resolved against Colab's
  package snapshot, protspace itself accepts every version Colab ships. Its `biocentral-api` 2.x
  client requires tqdm ≥4.68, and through `biotrainer-core` (every release) numpy >=2.4.1,<2.5,
  pandas ≥2.3.3 and h5py ≥3.15, yet uses only biotrainer-core's `SequenceData` and FASTA reader.
- Generate and Transfer & Download showed little between the click and "Done", and the file
  arrived a good while after it: `files.download()` returns once the browser is told to fetch the
  file, and the transfer runs afterwards.
- With all methods selected at 1440 px, the parameter boxes still left 112 px slider tracks. After
  Generate, the EAT target preselected a UniProt column that was empty for every protein.
- Layout and contrast were checked by hand in Colab.

## What Changes

- The install cells of every Colab notebook share one helper. It installs uv and runs
  `uv pip install --override`, holding every loaded distribution at its loaded version. pip is the
  fallback, and the restart check stays as the safety net. A committed Colab snapshot and two
  tests keep protspace installable that way.
- Generate shows "Step k of n · …" with a bar and the elapsed time. The reduction step counts its
  projections, and the last step is "Preparing the download (N KB)". The final state says the
  download started and when the file arrives, and a Download bundle button lists every bundle in
  `output/`.
- EAT lists only columns with values to copy and gaps to fill, with their counts, and preselects
  none. Its button is disabled while it runs, and it shows the same steps and download state. The
  Transfer notebook says when its downloads start and adds a bundle download.
- The parameter groups wrap at 350 px. The success button gets a 5.1:1 green.
- A committed harness (`apps/protspace/scripts/notebook_harness/`) renders the panel in Voila
  with ipywidgets 7.7.1 and 8. It drives 120 states per version with headless Playwright and checks
  slider tracks, overflow, contrast and Generate. It also screenshots the progress states.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-input-handling`: the install cells hold loaded packages, Generate shows its progress
  and download, the sliders keep usable tracks at every width, and the harness checks the panel.
- `notebook-annotation-transfer`: EAT's column list and progress; the Transfer notebook's
  downloads.

## Impact

- The three Colab notebooks; `apps/protspace/tests/test_notebooks.py`,
  `tests/test_colab_compat.py`, `tests/test_notebook_harness.py`, `tests/data/colab/`;
  `apps/protspace/scripts/notebook_harness/`; `.github/workflows/protspace-ci.yml`.
- Docs: `docs/guide/data-preparation.md`, `apps/protspace/CLAUDE.md`.
