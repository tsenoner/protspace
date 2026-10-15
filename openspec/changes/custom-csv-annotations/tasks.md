## 1. Failing tests first

- [ ] 1.1 `tests/test_custom_annotations.py`: loader cases (second file merged, tab and semicolon in
      a `.csv`, one-column warning, `.CSV`/`.txt`, `protein_id` and `identifier` not first, two
      id-named columns, empty cells, CRLF and mixed endings, BOM, column in two files, unmatched-id
      warning, output aligned to the input ids, plain-text cells encoded)
- [ ] 1.2 `prepare` end to end: two CSVs both reach the bundle, no `nan` cells
- [ ] 1.3 `annotate`, `stats`, `bundle` with a CSV; non-parquet input and unknown source name as
      usage errors; `stats` and `bundle` resolving a parquet's id column alike
- [ ] 1.4 `project -a` / `--stats` usage error naming `prepare` and `bundle`; neither in `--help`
- [ ] 1.5 Embedding-option warnings on HDF5 input; none with defaults; `--max-length` no longer
      fails there
- [ ] 1.6 A fresh-interpreter HDF5-only `prepare` leaves `protspace.data.embedding`,
      `biocentral_api` and `torch` out of `sys.modules`
- [ ] 1.7 Run them and watch each fail for the stated reason

## 2. Shared loader

- [ ] 2.1 `data/processors/custom_annotations.py`: suffix test and `-a` splitting, id-column rule,
      header-sniffed delimiter, text read, merge with collision error, per-file coverage report,
      v2 encoding, output aligned to the input ids, fetched-column override
- [ ] 2.2 `ReductionPipeline` reads every file through it; `run()` keeps empty cells empty

## 3. Commands

- [ ] 3.1 `annotate -a`: files beside names, files only fetch nothing, unknown names a usage error
- [ ] 3.2 `stats -a`: CSV scored and written to `<projections>/selected_annotations.parquet`;
      shared id-column rule for a parquet; unreadable input a usage error
- [ ] 3.3 `bundle -a`: CSV through the loader; shared id-column rule; unreadable input a usage error
- [ ] 3.4 `project`: hidden `-a/--annotations` and `--stats` refusing with the routes; help names
      `prepare`
- [ ] 3.5 `prepare`: embedding config only when embedding; warnings for ignored options; `run.log`
      without embedding settings; `-b`/`--max-length` help says they apply only when embedding

## 4. Docs

- [ ] 4.1 `docs/guide/python-cli.md`: "Which command do I need?", H5 + CSV + `--stats` example
      (2-D methods), `-b` row, "Custom annotation files" with the rules and every command, the
      stepwise recipe, `project`/`annotate`/`stats`/`bundle` `-a` rows, "Upgrading from v4.4",
      `KeyError: 'ESM_8M'` troubleshooting
- [ ] 4.2 `docs/guide/faq.md`: custom-annotation answer, bundle part count
- [ ] 4.3 `apps/protspace/CLAUDE.md`: new module and test file
- [ ] 4.4 Check the Colab notebooks for anything restating the CSV rules

## 5. Verify

- [ ] 5.1 `openspec validate custom-csv-annotations --strict`
- [ ] 5.2 `uv run --directory apps/protspace pytest` (non-slow) and ruff
- [ ] 5.3 `pnpm precommit` and `pnpm format:check`
