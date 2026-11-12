## 1. Bugs

- [x] 1.1 Install cell (Preparation and Transfer): detect a distribution pip changed under an
      already-imported module, stop with a restart message naming it, keep stopping until restart
- [x] 1.2 Methods sliders capped to `DimensionReductionConfig`; perplexity an `IntSlider` 5–50,
      fp_ratio above 0
- [x] 1.3 EAT cell: cutoff (auto by default, number, off), leave distant queries unpredicted, k,
      distant count, neighbour report TSV download, fallback for released protspace
- [x] 1.4 Tests: stale-module check with fake modules, slider bounds pinned to the config, EAT
      cutoff/skip/report and the fallback

## 2. Panel usability

- [x] 2.1 CSS scoped to the panel: collapsed Accordion headers (ipywidgets 7 and 8), tab labels,
      placeholders and notes readable in Colab light and dark
- [x] 2.2 Status card: running step, success (file, size, time, downloaded, where the copy is),
      failure with advice matching the error
- [x] 2.3 A path field's change clears its stale status
- [x] 2.4 CLI wording in log lines and errors rewritten for the panel; _Fetch annotations again_
- [x] 2.5 No UniProt fetch when no ID is an accession; CSV only when a CSV is given
- [x] 2.6 EAT target list refreshed after a successful Generate
- [x] 2.7 Settings saved in the runtime on Generate and restored when the panel is rebuilt
- [x] 2.8 Tab and section labels by what users recognise
- [x] 2.9 Tests for 2.2–2.7

## 3. Docs and checks

- [x] 3.1 `docs/guide/data-preparation.md`, `docs/explore/eat.md`, `apps/protspace/CLAUDE.md`
- [x] 3.2 Render the panel (Voila, ipywidgets 7.7.1 and 8) in light/dark, before/after shots
- [x] 3.3 `pytest tests/test_notebooks.py` on ipywidgets 8 and 7.7.1, the fast suite,
      `pnpm precommit`, `pnpm format:check`

## 4. The other Colab notebooks

- [x] 4.1 Reproduce the Embeddings notebook's import warnings against googlecolab/backend-info
- [x] 4.2 Embeddings: settings first, esm SDK only for its models, TensorFlow/JAX off, `get_token`,
      stale-package check, load report quieted, specific messages per step
- [x] 4.3 Transfer: `--max-distance auto`, near/distant counts, messages for a missing input
- [x] 4.4 Methods groups wrap before their tracks collapse (#346); learning-rate default on its grid
- [x] 4.5 Render all three notebooks in Voila (ipywidgets 7.7.1 and 8), light/dark, 420–1100 px
