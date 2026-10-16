## Why

`DimensionReductionConfig` refused a t-SNE perplexity above 50, although scikit-learn's only
limit is that perplexity stays below the number of samples, and the CLI guide already says
"≥ 5. Should be below `n_samples / 3`": a large dataset could not use a larger perplexity. The
limit that does exist was not checked: a perplexity at or above the protein count (the default 30
on 20 proteins) failed with scikit-learn's traceback, after the embeddings and annotations.

## What Changes

- `perplexity` keeps its floor of 5 and loses its ceiling of 50, in the config the CLI, the
  pipeline and the Colab panel all go through.
- The pipeline refuses a t-SNE perplexity at or above the number of proteins before fetching
  annotations, naming both numbers and the `n / 3` rule of thumb; the t-SNE reducer refuses it the
  same way as a backstop for direct callers.
- n_neighbors at or above the protein count is left alone: UMAP, PaCMAP and LocalMAP lower it
  themselves and say so.
- The Colab panel's perplexity slider goes back to a wide range, and Generate checks it against
  the input's protein count before it starts.

## Capabilities

### New Capabilities

- `reducer-parameter-limits`: which reducer parameter values are refused, when, and how.

### Modified Capabilities

None.

## Impact

- `apps/protspace/src/protspace/utils/constants.py`, `utils/reducers.py`,
  `data/processors/pipeline.py`; `prepare` and `project` accept a perplexity above 50.
- The Preparation notebook; `docs/guide/python-cli.md`, `docs/guide/data-preparation.md`.
- Tests: `test_config_validation.py`, `test_reducers.py`, `test_pipeline_utils.py`,
  `test_notebooks.py`.
