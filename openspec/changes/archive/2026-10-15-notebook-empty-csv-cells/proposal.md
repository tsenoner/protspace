## Why

The Preparation notebook turned empty cells of a custom CSV into the label `nan` (#550). It
rebuilds `ReductionPipeline.run()`'s annotations step to show progress, and its copy stringified
the table with `astype(str)` without filling the nulls first, which `run()` does. Released
protspace (<= 4.16) reads an empty CSV cell as a null, so on Colab every empty cell became a
`nan` category: coloured, counted and exported like a real value. The CLI and the notebook gave
different bundles for the same CSV.

## What Changes

- `protspace.data.processors.pipeline.align_annotations(metadata, headers)`: the annotations
  table the bundle is built from, one row per protein, keyed on `protein_id`, every missing cell
  empty. `run()` uses it, and so does the notebook, in place of its own copy.
- The notebook falls back to an inline copy, with the null fill, for released protspace <= 4.16,
  which has no `align_annotations`.

## Capabilities

### Modified Capabilities

- `notebook-input-handling`: the panel's annotations table leaves missing cells missing.

## Impact

- `apps/protspace/src/protspace/data/processors/pipeline.py`, `notebooks/ProtSpace_Preparation.ipynb`.
- Tests: `tests/test_notebooks.py` (a CSV with empty cells, under the current package and a
  released one), `tests/test_pipeline_utils.py`.
- Docs: `apps/protspace/CLAUDE.md` (the notebook test row).
