## 1. Bugs

- [ ] 1.1 Install cell (Preparation and Transfer): detect a distribution pip changed under an
      already-imported module, stop with a restart message naming it, keep stopping until restart
- [ ] 1.2 Methods sliders capped to `DimensionReductionConfig`; perplexity an `IntSlider` 5–50,
      fp_ratio above 0
- [ ] 1.3 EAT cell: cutoff (auto by default, number, off), leave distant queries unpredicted, k,
      distant count, neighbour report TSV download, fallback for released protspace
- [ ] 1.4 Tests: stale-module check with fake modules, slider bounds pinned to the config, EAT
      cutoff/skip/report and the fallback

## 2. Panel usability

- [ ] 2.1 CSS scoped to the panel: collapsed Accordion headers (ipywidgets 7 and 8), tab labels,
      placeholders and notes readable in Colab light and dark
- [ ] 2.2 Status card: running step, success (file, size, time, downloaded, where the copy is),
      failure with advice matching the error
- [ ] 2.3 A path field's change clears its stale status
- [ ] 2.4 CLI wording in log lines and errors rewritten for the panel; _Fetch annotations again_
- [ ] 2.5 No UniProt fetch when no ID is an accession; CSV only when a CSV is given
- [ ] 2.6 EAT target list refreshed after a successful Generate
- [ ] 2.7 Settings saved in the runtime on Generate and restored when the panel is rebuilt
- [ ] 2.8 Tab and section labels by what users recognise
- [ ] 2.9 Tests for 2.2–2.7

## 3. Docs and checks

- [ ] 3.1 `docs/guide/data-preparation.md`, `docs/explore/eat.md`, `apps/protspace/CLAUDE.md`
- [ ] 3.2 Render the panel (Voila, ipywidgets 7.7.1 and 8) in light/dark, before/after shots
- [ ] 3.3 `pytest tests/test_notebooks.py` on ipywidgets 8 and 7.7.1, the fast suite,
      `pnpm precommit`, `pnpm format:check`
