## 1. Notebook

- [x] 1.1 Remove ESM3 (form, links, short key, loader, embedding loop) and the `esm` install
- [x] 1.2 Remove the install helper and the TensorFlow/JAX/torchao switches; keep the safetensors switch
- [x] 1.3 Name the transformers upgrade when ESM C asks for remote code (transformers < 5.16)

## 2. Package and tests

- [x] 2.1 Keep `esm3_open` in `MODEL_DISPLAY_NAMES` for old files, pinned by a file-name case
- [x] 2.2 Install-helper tests run on the notebooks that install; the Embeddings notebook is checked to install nothing
- [x] 2.3 Notebook tests on ipywidgets 8 and 7.7.1

## 3. Docs

- [x] 3.1 READMEs, data-preparation and CLI guides, `apps/protspace/CLAUDE.md`
