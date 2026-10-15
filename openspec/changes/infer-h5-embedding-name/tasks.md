## 1. Failing tests first

- [ ] 1.1 Loader: explicit > attribute > file-name key (whole stem, trailing tokens, longest, case) > error without a CLI command or `prot_t5` in it
- [ ] 1.2 Resolver: single unnamed input falls back to its stem with an info line; several unnamed inputs raise before loading, with the command's own example and paths; FASTA inputs count as inputs; directories resolve by their files, then their own name
- [ ] 1.3 Registry: every `EMBEDDER_MODELS` key and every ClickThrough notebook short key is recognised from a file name
- [ ] 1.4 CLI: `prepare`, `project`, `stats`, `transfer` each run on one unnamed file and refuse two (where they take several)
- [ ] 1.5 `stats`: adopts the single source for a file-named input, refuses several non-matching sources, leaves an explicit name alone

## 2. Implementation

- [ ] 2.1 `resolve_input_names` and the file-name rule in `data/loaders/h5.py`; `load_h5` applies rules 1-3
- [ ] 2.2 `esm3_open` in `MODEL_DISPLAY_NAMES`
- [ ] 2.3 `prepare`, `project`, `stats`, `transfer` resolve names through it before loading
- [ ] 2.4 `stats` reconciles a file-named single input with the projections' source

## 3. Docs

- [ ] 3.1 `docs/guide/python-cli.md`: model-name resolution section, `-i`/`-e` rows, the "external HDF5" example
- [ ] 3.2 `apps/protspace/CLAUDE.md`: h5.py line and the test row

## 4. Verify

- [ ] 4.1 `uv run pytest` for `apps/protspace`, `ruff check`, `ruff format --check`
- [ ] 4.2 `openspec validate infer-h5-embedding-name --strict`
