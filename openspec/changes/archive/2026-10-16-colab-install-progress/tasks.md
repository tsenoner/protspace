## 1. Install

- [x] 1.1 Resolve protspace[local] against Colab's snapshot; name the dependency that forces upgrades
- [x] 1.2 One install helper in every notebook: uv `--override` of loaded distributions, pip
      fallback, restart check as safety net; a test keeps the copies identical
- [x] 1.3 Snapshot in `tests/data/colab` with refresh notes; offline and opt-in resolve tests; CI step

## 2. Feedback

- [x] 2.1 Generate: stages, bar, elapsed time, projection count from the log, download state,
      Download bundle list
- [x] 2.2 EAT: fillable columns with counts, none preselected, button disabled, steps, download
- [x] 2.3 Transfer notebook: download messages, bundle download step
- [x] 2.4 Perplexity checked against the protein count before Generate (see lift-perplexity-cap)

## 3. Layout and harness

- [x] 3.1 Groups wrap at 350 px; success-button contrast
- [x] 3.2 Harness: Voila (ipywidgets 7.7.1 and 8), 120 states each, checks, progress screenshots;
      README; opt-in test; clean on both, and failing on main's notebook as it should
