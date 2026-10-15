## Why

A user with pre-generated embeddings reported that in the Preparation notebook "the Generate
button didn't do anything" and "the UI got stuck", while the Embeddings notebook worked. Three
defects in the panel's input handling explain it, and each one is enough on its own:

- **The Upload-H5 tab never names the embedding.** `load_h5` needs a name or a `model_name`
  attribute, and the files the Embeddings notebook writes have neither, so Generate always
  fails for them. The error shows CLI syntax (`-i file.h5:prot_t5`) that cannot be typed into
  the panel and that would mislabel an ESM2 file.
- **Files go through `ipywidgets.FileUpload`.** It sends the whole file as one websocket
  message. A 22-25 MB HDF5 (4,000 proteins at 1,280 dimensions) is over twice the 10 MiB
  limit reported for Jupyter's transport (jupyter-widgets/ipywidgets#2522); the upload fails
  without an error and can leave the widget connection unresponsive. The Embeddings notebook
  uses `google.colab.files.upload()` instead, which sends the file in chunks.
- **A failed input falls back silently.** Generate uses whatever input was set last, and the
  cell auto-selects an example at the end, so a failed upload processes 536 example proteins
  with nothing saying so.

Smaller defects make the same symptoms worse: the example fetch at the end of the cell has no
timeout, so a slow connection leaves a dead panel; Generate can be clicked again while it runs;
observer errors go nowhere; the CSV `FileUpload` code reads the ipywidgets 7 value shape and
breaks under 8; the install cell's guard catches only `ImportError` (between 2026-10-01 and
10-07 a `KeyError` from the Biocentral client killed it); and the panel's UMAP `min_dist`
default (0.4) differs from the CLI's (0.1) for no recorded reason.

## What Changes

- **H5 input by path, named.** The Upload-H5 tab takes a path in the runtime (Files pane, Drive
  or the new upload cell) and has an embedder dropdown. _Auto-detect_, the default, applies the
  CLI's name rules (`infer-h5-embedding-name`): attribute, then a model key at the end of the
  file name, then the stem. The Ready line says which name will be used and why.
- **A dedicated upload cell** above the panel calls `google.colab.files.upload()` when its
  checkbox is ticked, into a fresh folder per run so a re-upload under the same name is not
  renamed, and fills the matching tab's path field. It is skipped by default, so
  _Run all_ never stops at a file picker. FASTA uses a path field the same way; the custom CSV
  keeps its small `FileUpload`, now written for both ipywidgets 7 and 8, beside a path field.
- **Generate uses the selected tab, or refuses.** Each tab keeps its own input. An empty tab
  gets a visible message naming what to do; a ready one is echoed (dataset, protein count,
  embedding name) before the run starts.
- **Responsive panel.** The example is fetched when Generate needs it, with a timeout, not at
  the end of the cell. Generate is disabled while it runs. Observer callbacks and protspace's
  log lines are routed into the panel's output.
- **Methods:** a distance-metric selector for UMAP and t-SNE (the CLI's `--metric` choices).
  UMAP `min_dist` defaults to 0.1, as in the CLI. Projections stay 2-D; no dimension selector.
- **Annotations:** a _CSV only_ preset that fetches nothing from UniProt.
- **Install cell** guard catches any exception, with the restart and upgrade hint.
- **Embeddings notebook** writes `model_name` on the HDF5 it produces.
- **Going further** cell: the CLI example no longer depends on a name it cannot infer.
- **Docs:** `docs/guide/data-preparation.md` describes the four-tab panel, the upload routes and
  their size caveat, Run all behaviour, the 2-D-only scope, and MDS parameters as CLI-only; the
  stale taxonomy-download tip goes.

## Capabilities

### New Capabilities

- `notebook-input-handling`: how the Preparation notebook gets an input into the runtime, names
  it, and decides which input Generate runs on.

### Modified Capabilities

None. (`notebook-generate-output-identity`, still in the unarchived `fix-cache-ownership`
change, covers the output name and parameter scope; this change does not touch either.)

## Impact

- Notebooks: `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`,
  `apps/protspace/notebooks/ClickThrough_GenerateEmbeddings.ipynb`.
- Tests: `apps/protspace/tests/test_notebooks.py` executes the panel and Generate with the
  installed ipywidgets and a mocked `google.colab`; `apps/protspace/CLAUDE.md` row.
- Docs: `docs/guide/data-preparation.md`.
- No package code beyond `infer-h5-embedding-name`, which the H5 tab's Auto-detect uses when the
  installed release has it (and falls back to the same rules, written in the cell, when it does
  not).
