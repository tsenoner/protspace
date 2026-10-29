## Why

The Embeddings notebook took nine cells (settings, install, imports, a login, Drive, the FASTA,
functions, generate, download) to embed a FASTA. It installed `pyfaidx` and, for ESM C and ESM3,
the `esm` package, which replaces Colab's transformers 5 and needed a Hugging Face login. Loading
ProtT5 downloaded its 2.4 GB twice: ProtT5, ProstT5 and Ankh publish only `pytorch_model.bin`, and
transformers 5 then fetches a converted `model.safetensors` in the background. Every run reloaded
the model, and its output was a stack of download bars.

Since 2026-08-20 transformers has its own port of the official ESM C (`esmc`, in 5.18, Colab's
version), and Biohub publishes the weights as `biohub/ESMC-300M` / `-600M`, MIT and ungated. They
give the same per-protein embeddings as Synthyra's ESM++ (cosine 1.000000 on the test sequences).
ESM3 moved to `biohub/esm3-sm-open-v1`, MIT and ungated, and still needs the `esm` package.

The notebook is also useful on its own, as a simple embedding tool, and should be listed as one.

## What Changes

- One cell holds every setting as a form field (model, per protein or per residue, FASTA path or
  upload or the example, UniProt accessions as IDs, maximum length, batch size, an optional
  Hugging Face token) and runs the whole job; an optional cell downloads the `.h5` again.
- ESM C runs on transformers' own port of `biohub/ESMC-300M` / `-600M`: no `esm` package, no login.
  ESM3 (`biohub/esm3-sm-open-v1`) installs the `esm` package, only for itself. Nothing else is
  installed: the FASTA parser is the notebook's own.
- `DISABLE_SAFETENSORS_CONVERSION` stops the second weights download; the model stays loaded across
  re-runs, and proteins already in the `.h5` are skipped.
- Output: one line per stage (model, proteins, IDs, weights with a live timer, saved), one
  embedding progress bar, and the `.h5` downloaded at the end. Hugging Face's download bars and
  load reports are hidden.
- A `/content/drive/...` path mounts Drive on its own; a '/' in an ID becomes '\_' instead of
  stopping the run; UniProt accessions are the default IDs; per-residue files get a `_per_res`
  suffix, so they never mix with per-protein ones.
- The root README, the package README and the docs present the notebook as a simple embedding tool.

## Capabilities

### Modified Capabilities

- `notebook-embedding-generation`

## Impact

`ClickThrough_GenerateEmbeddings.ipynb`, `tests/test_notebooks.py`, `README.md`,
`apps/protspace/README.md`, `docs/guide/data-preparation.md`, `docs/guide/python-cli.md`,
`apps/protspace/CLAUDE.md`. No package change; protspace's own local backend still runs ESM C
through Synthyra's ESM++ (a separate change).
