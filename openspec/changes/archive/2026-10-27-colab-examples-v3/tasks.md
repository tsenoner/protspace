## 1. Bundles

- [x] 1.1 Add `scripts/generate_examples/refresh_colab_examples.py`: keep each old bundle's
      projections, fetch its proteins' annotations with `protspace annotate` (the dataset's set in
      `datasets.toml`), write `<name>_v3.parquetbundle` with `protspace bundle`, check proteins and
      the v3 container
- [x] 1.2 Build the five `_v3` bundles and check their annotations equal what the panel's own
      fetch returns for the same proteins

## 2. Notebooks

- [x] 2.1 Preparation panel: take requested columns from the example's `_v3` bundle, fetch the rest
      and a custom CSV; skip with "Fetch annotations again" or an unreadable bundle; note the reuse
- [x] 2.2 Transfer notebook: fetch `snake_toxin_v3.parquetbundle`, update its counts from the new
      bundle

## 3. Tests and checks

- [x] 3.1 Notebook tests: an Example run with default annotations fetches nothing and its bundle
      holds the example bundle's values; a missing column is fetched; Refetch fetches all; an
      unreadable bundle falls back
- [x] 3.2 `test_notebooks.py` with the default ipywidgets and 7.7.1, the fast suite,
      `pnpm precommit`

## 4. Release

- [x] 4.1 Upload the five `_v3` bundles to the `examples` release and list them in its notes
