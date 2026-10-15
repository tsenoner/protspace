## 1. Failing tests first

- [x] 1.1 Loader: explicit > attribute > file-name key (whole stem, trailing tokens, longest, case) > error without a CLI command or `prot_t5` in it
- [x] 1.2 Resolver: single unnamed input falls back to its stem with an info line; several unnamed inputs raise before loading, with the command's own example and paths; FASTA inputs count as inputs; directories resolve by their files, then their own name
- [x] 1.3 Registry: every `EMBEDDER_MODELS` key and every ClickThrough notebook short key is recognised from a file name
- [x] 1.4 CLI: `prepare`, `project`, `stats`, `transfer` each run on one unnamed file and refuse two (where they take several)
- [x] 1.5 `stats`: adopts the single source for a file-named input, refuses several non-matching sources, leaves an explicit name alone
- [x] 1.6 A directory whose file names point to different models is refused, by the resolver and by `load_h5` (review)
- [x] 1.7 `project` refuses two inputs of the same name, inferred or explicit, without a traceback (review)

## 2. Implementation

- [x] 2.1 `resolve_input_names` and the file-name rule in `data/loaders/h5.py`; `load_h5` applies rules 1-3
- [x] 2.2 `esm3_open` in `MODEL_DISPLAY_NAMES`
- [x] 2.3 `prepare`, `project`, `stats`, `transfer` resolve names through it before loading
- [x] 2.4 `stats` reconciles a file-named single input with the projections' source
- [x] 2.5 `_model_from_file_names` raises on files from different models (review)
- [x] 2.6 `project` checks resolved names for duplicates before loading; its unnamed-inputs hint says the names must differ (review)

## 3. Docs

- [x] 3.1 `docs/guide/python-cli.md`: model-name resolution section (incl. mixed-model directories), `-i`/`-e` rows, the "external HDF5" example, `project` refusing same-name inputs
- [x] 3.2 `apps/protspace/CLAUDE.md`: h5.py line and the test row

## 4. Verify

- [x] 4.1 `uv run pytest` for `apps/protspace`, `ruff check`, `ruff format --check`
- [x] 4.2 `openspec validate infer-h5-embedding-name --strict`
