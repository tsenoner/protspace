## Why

An external user ran the Preparation notebook in Colab (dark mode) on 5,035 proteins with an
ESM2-650M `.h5`, a custom CSV and non-UniProt IDs, and hit three bugs and a run of friction:

- The install cell upgraded numpy on disk while Colab had the old one loaded; its import check
  passed and Generate then failed on a numpy internals error until a manual restart.
- The perplexity slider went to 500 while protspace accepts 5 to 50, so t-SNE failed at Generate.
- The EAT cell ran an unguarded k=1 transfer: with references that were all toxins, every
  unknown protein became a toxin, with no distance cutoff and no neighbour report to show it.
- Collapsed section titles were near-black on dark grey; a stale "No file received" message sat
  under a newly uploaded path; every failure printed the same unrelated troubleshooting list;
  log lines told Colab users to pass CLI flags; a UniProt fetch ran for IDs that cannot match;
  the EAT target list stayed empty until a manual reload; and a session restart lost every
  setting.

## What Changes

- The install cell of every Colab notebook stops with a restart message naming each package pip
  changed under an already-imported module, and keeps stopping until the session restarts.
- Every Methods slider stays within the range `DimensionReductionConfig` accepts; perplexity is an
  integer slider from 5 to 50.
- The EAT cell calibrates a distance cutoff (`auto`, as `protspace transfer --max-distance auto`)
  by default, offers a numeric cutoff, no cutoff, and leaving distant queries unpredicted, keeps
  k, reports how many queries were distant, and offers the neighbour report as a TSV download.
  Under a released protspace without these options it says so and runs the plain transfer.
- The panel: contrast that holds in Colab's light and dark modes for ipywidgets 7 and 8; a status
  card that says what runs, what failed with advice for that failure, and where the bundle went;
  CLI wording in log lines translated to the panel's controls; a _Fetch annotations again_ box;
  no UniProt fetch when no ID is an accession (CSV only when a CSV is given); the EAT column list
  refreshed after each Generate; settings kept in the runtime and restored after a restart; tabs
  named by what they take.
- The Embeddings notebook (`ClickThrough_GenerateEmbeddings.ipynb`), run against Colab's package
  snapshot (Python 3.13, transformers 5.18, huggingface_hub 1.33), installed the `esm` SDK for every
  model: it pins transformers < 5, so pip replaced transformers, tokenizers and huggingface_hub, and
  transformers 4.57 then imported TensorFlow, JAX and torchao (the import warnings users saw). It now
  takes the model first and installs the SDK only for the EvolutionaryScale models, switches
  TensorFlow and JAX off for transformers, uses `get_token` (huggingface_hub 1.x has no `HfFolder`),
  gets the install cell's stale-package check, and says what each step did or why it stopped.
- The Transfer notebook runs its example with `--max-distance auto` (protspace 4.17.0), counts near
  and distant predictions, and stops with what to do when a step's input is missing.
- The Methods parameter groups wrap before their slider tracks collapse in a narrow pane (#346, the
  approach of #409), and the learning-rate slider holds the CLI's default.

## Capabilities

### New Capabilities

- `notebook-embedding-generation`: how the Embeddings notebook installs, imports and reports.
- `notebook-annotation-transfer`: how the Preparation notebook's EAT cell transfers labels (the
  default distance cutoff, the distant-query option, the neighbour report, the fallback for a
  released protspace without them) and how the Transfer notebook reports near and distant ones.

### Modified Capabilities

- `notebook-input-handling`: the install cell's stale-module check, slider bounds, failure
  advice, panel wording, the non-UniProt-ID path, and settings that survive a restart.

## Impact

- `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`, `ProtSpace_Transfer.ipynb`,
  `ClickThrough_GenerateEmbeddings.ipynb`
- `apps/protspace/tests/test_notebooks.py`
- `docs/guide/data-preparation.md`, `docs/explore/eat.md`, `apps/protspace/CLAUDE.md`
- No package code changes: the notebook uses `run_transfer`'s `max_distance`, `skip_distant` and
  `report` arguments and `write_report` (protspace 4.17.0). Installing protspace on Colab still
  upgrades numpy and pandas (biocentral-api 2.x requires biotrainer-core, which pins numpy >= 2.4.1
  and pandas >= 2.3.3), so a fresh runtime's first setup asks for one restart; the dependency itself
  is a separate change.
